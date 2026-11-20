"""Đạo diễn lồng tiếng": làm cho giọng Việt sát với tính chất và nội dung video.

- Hồ sơ video (thể loại, văn phong, xưng hô, thuật ngữ) rút ra từ tiêu đề + lời thoại đầu.
- Nghe cao độ giọng gốc của từng câu để biết nam / nữ / trẻ em, và tách các người nói
  khác nhau để mỗi người có một giọng Việt riêng, nhất quán suốt video.
- Cảm xúc từng câu (do mô hình dịch gán) + độ to của giọng gốc → tốc độ, cao độ, âm lượng.
"""
import re
import subprocess
import threading
import time

import numpy as np

SR = 16000
MALE, FEMALE = "vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural"

# Cảm xúc → (tốc độ %, cao độ Hz, âm lượng %)
EMOTIONS = {
    "bình thường": (0, 0, 0),
    "vui": (6, 4, 4),
    "hào hứng": (12, 8, 10),
    "buồn": (-12, -6, -12),
    "giận": (6, -3, 15),
    "sợ": (8, 6, -6),
    "ngạc nhiên": (6, 10, 6),
    "thì thầm": (-10, -3, -40),
    "nghiêm túc": (-4, -3, 0),
    "dịu dàng": (-8, 2, -12),
    "mỉa mai": (-4, 3, 0),
    "hét": (10, 4, 25),
}
EMO_LIST = ", ".join(EMOTIONS)

# Thể loại → nhịp đọc nền (tốc độ %, cao độ Hz)
GENRE_PACE = {"tin tức": (6, 0), "thể thao": (10, 3), "quảng cáo": (8, 3), "game": (6, 2), "review": (4, 0),
              "tài liệu": (-4, -2), "bài giảng": (-2, 0), "kể chuyện": (-6, -1), "hoạt hình": (2, 4), "podcast": (0, 0)}
PACE = {"chậm": -6, "vừa": 0, "nhanh": 8}

# Mỗi người nói một giọng: (giọng, cao độ Hz, tốc độ %)
VARIANTS = {
    "m": [(MALE, 0, 0), (MALE, -8, -3), (MALE, 7, 3), (MALE, -14, -5)],
    "f": [(FEMALE, 0, 0), (FEMALE, 7, 2), (FEMALE, -7, -3), (FEMALE, 12, 4)],
    "c": [(FEMALE, 24, 4), (FEMALE, 32, 6), (MALE, 30, 5)],
}


# ---------------------------------------------------------------------------
# Âm thanh: cao độ và độ to
# ---------------------------------------------------------------------------
def read_pcm(path: str) -> np.ndarray | None:
    """Giải mã bất kỳ tệp âm thanh nào thành PCM float32 mono 16 kHz."""
    try:
        r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                           capture_output=True, timeout=120)
    except Exception:
        return None
    if r.returncode != 0 or not r.stdout:
        return None
    return np.frombuffer(r.stdout, dtype=np.float32)


def voice_features(pcm: np.ndarray | None, start: float, end: float) -> dict | None:
    """Cao độ trung vị (Hz) và độ to (dB) của đoạn [start, end] — tự tương quan theo khung 32 ms."""
    if pcm is None:
        return None
    x = pcm[max(0, int(start * SR)):int(end * SR)]
    win, hop = 512, 160
    if len(x) < win * 3:
        return None
    n = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    fr = x[idx] * np.hanning(win)[None, :]
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    loud = rms > max(0.006, 0.3 * np.percentile(rms, 90))
    if loud.sum() < 6:
        return None
    fr = fr[loud]
    spec = np.fft.rfft(fr, n=2 * win, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, axis=1)[:, :win]
    ac = ac / (ac[:, :1] + 1e-12)
    lo, hi = SR // 420, SR // 65  # 65–420 Hz
    seg = ac[:, lo:hi]
    best = seg.max(axis=1)
    # chọn đỉnh sớm nhất gần bằng đỉnh lớn nhất để tránh nhầm quãng tám thấp
    first = np.argmax(seg >= 0.9 * best[:, None], axis=1) + lo
    voiced = best > 0.45
    if voiced.sum() < 5:
        return None
    f0 = SR / first[voiced]
    return {"f0": float(np.median(f0)), "db": float(20 * np.log10(np.median(rms[loud]) + 1e-9)),
            "voiced": float(voiced.mean())}


def gender_of(f0: float | None, hint: str | None = None) -> str:
    """m = nam, f = nữ, c = trẻ em. Cao độ là chính, gợi ý từ lời thoại dùng khi lưng chừng."""
    h = {"nam": "m", "nữ": "f", "trẻ": "c", "m": "m", "f": "f", "c": "c"}.get((hint or "").strip().lower())
    if not f0:
        return h or "f"
    if f0 < 150:
        return "m"
    if f0 < 178:
        return h if h in ("m", "f") else ("m" if f0 < 165 else "f")
    if f0 > 285:
        return "c" if h != "f" else "f"
    if f0 > 255 and h == "c":
        return "c"
    return "f" if h != "m" or f0 > 200 else "m"


# ---------------------------------------------------------------------------
# Phiên: nhớ hồ sơ video và các người nói
# ---------------------------------------------------------------------------
SESS: dict = {}
_lock = threading.Lock()


def session(sid: str | None, title: str | None = None) -> dict:
    sid = re.sub(r"[^\w.:-]", "", sid or "")[:80]
    now = time.time()
    with _lock:
        if len(SESS) > 400:
            for k in sorted(SESS, key=lambda k: SESS[k]["t"])[:100]:
                SESS.pop(k, None)
        s = SESS.get(sid) if sid else None
        if s is None:
            s = {"lines": [], "profile": None, "built_at": 0, "building": False, "speakers": [], "db": [], "title": ""}
            if sid:
                SESS[sid] = s
        s["t"] = now
        if title and not s["title"]:
            s["title"] = title.strip()[:200]
    return s


def assign_speaker(s: dict, g: str, f0: float | None) -> dict:
    with _lock:
        same = [p for p in s["speakers"] if p["g"] == g]
        if f0:
            near = min(same, key=lambda p: abs(np.log(f0 / p["f0"])), default=None)
            if near and abs(np.log(f0 / near["f0"])) < 0.13:
                near["f0"] = 0.85 * near["f0"] + 0.15 * f0
                near["n"] += 1
                return near
            if len(same) >= len(VARIANTS[g]) and near:
                return near
        elif same:
            return max(same, key=lambda p: p["n"])
        p = {"id": len(s["speakers"]), "g": g, "f0": f0 or {"m": 120, "f": 215, "c": 300}[g], "n": 1,
             "v": VARIANTS[g][len(same) % len(VARIANTS[g])]}
        s["speakers"].append(p)
        return p


def need_profile(s: dict) -> bool:
    n = len(s["lines"])
    return not s["building"] and ((not s["profile"] and n >= 4) or (s["built_at"] and s["built_at"] < 25 <= n))


def profile_prompt(s: dict) -> str:
    sample = " / ".join(s["lines"][:40])[:3500]
    return (
        "Bạn là đạo diễn lồng tiếng. Dựa vào tiêu đề và lời thoại gốc dưới đây, hãy phân tích video để chỉ đạo việc "
        "dịch và lồng tiếng Việt sao cho sát tính chất và nội dung.\n"
        f"Tiêu đề: {s['title'] or '(không rõ)'}\n"
        f"Lời thoại: {sample}\n\n"
        "Chỉ trả về JSON:\n"
        '{"genre":"một trong: phim truyện, hoạt hình, tin tức, tài liệu, vlog, hướng dẫn, review, game, thể thao, '
        'ca nhạc, bài giảng, quảng cáo, talkshow, podcast, kể chuyện, khác",'
        '"summary":"video nói về gì (1 câu)",'
        '"tone":"văn phong tiếng Việt nên dùng khi dịch (1 câu, cụ thể)",'
        '"address":"quy tắc xưng hô tiếng Việt giữa các nhân vật / với khán giả (vd: người dẫn xưng mình, gọi khán giả là các bạn)",'
        '"glossary":{"thuật ngữ gốc":"cách dịch thống nhất"},'
        '"keep":["tên riêng / thương hiệu giữ nguyên"],'
        '"pace":"chậm|vừa|nhanh","energy":"thấp|vừa|cao"}'
    )


def profile_text(p: dict | None) -> str:
    if not p:
        return ""
    out = []
    if p.get("genre"):
        out.append(f"- Thể loại video: {p['genre']}" + (f" — {p['summary']}" if p.get("summary") else ""))
    if p.get("address"):
        out.append(f"- Xưng hô: {p['address']}")
    g = p.get("glossary") or {}
    if isinstance(g, dict) and g:
        out.append("- Thuật ngữ thống nhất: " + "; ".join(f"{k} → {v}" for k, v in list(g.items())[:15]))
    k = p.get("keep") or []
    if isinstance(k, list) and k:
        out.append("- Giữ nguyên: " + ", ".join(map(str, k[:15])))
    return "\n".join(out) + ("\n" if out else "")


def prosody(s: dict, emo: str | None, db: float | None, vi: str, slot: float | None, spk_rate: int = 0) -> tuple[int, int, int]:
    """(tốc độ %, cao độ Hz, âm lượng %) cho một câu."""
    p = s.get("profile") or {}
    r, pt = GENRE_PACE.get(str(p.get("genre", "")).lower(), (0, 0))
    r += PACE.get(str(p.get("pace", "")).lower(), 0) // 2
    er, ep, ev = EMOTIONS.get((emo or "").strip().lower(), (0, 0, 0))
    r, pt, vol = r + er + spk_rate, pt + ep, ev
    if db is not None:
        hist = s["db"]
        hist.append(db)
        del hist[:-200]
        if len(hist) >= 5:
            d = db - float(np.median(hist))
            vol += int(max(-20, min(20, d * 2)))
    # vừa khung thời gian của câu gốc (~14,5 ký tự/giây ở tốc độ thường)
    if slot and vi:
        need = len(vi) / 14.5 / (1 + r / 100)
        if need > slot * 1.05:
            r = int((1 + r / 100) * need / slot * 100 - 100)
    return max(-30, min(45, r)), max(-40, min(40, pt)), max(-50, min(40, vol))


def direct(s: dict, seg: dict, feat: dict | None, auto_voice: bool) -> dict:
    """Quyết định giọng đọc cho một câu: {voice, pitch, rate, volume, g, spk, emo}."""
    f0 = feat and feat.get("f0")
    g = gender_of(f0, seg.get("g"))
    spk = assign_speaker(s, g, f0)
    voice, vp, vr = spk["v"]
    if f0 and g == "m" and f0 < 105:
        vp -= 4
    if f0 and g == "f" and f0 > 235:
        vp += 4
    slot = (seg["end"] - seg["start"]) if "end" in seg and "start" in seg else None
    rate, pitch, vol = prosody(s, seg.get("emo"), feat and feat.get("db"), seg.get("vi", ""), slot, vr if auto_voice else 0)
    out = {"g": g, "spk": spk["id"], "emo": seg.get("emo") or "bình thường", "rate": rate, "volume": vol}
    if auto_voice:
        out.update(voice=voice, pitch=max(-40, min(40, pitch + vp)))
    else:
        out["pitch"] = pitch
    if f0:
        out["f0"] = round(f0)
    return out
