"""Máy chủ tải video cho app Lồng tiếng Việt.

Dùng yt-dlp để tải video và phụ đề từ link (YouTube, TikTok, Facebook, ...),
trả về cho app chạy trong trình duyệt.

Biến môi trường:
  API_TOKEN          mã truy cập (khuyên dùng). App gửi qua header X-Api-Key.
  ALLOWED_ORIGINS    các nguồn được gọi, phân tách dấu phẩy. Mặc định "*".
  MAX_FILESIZE_MB    dung lượng video tối đa. Mặc định 500.
  MAX_DURATION_MIN   thời lượng video tối đa (phút). Mặc định 90.
  COOKIES_FILE       đường dẫn tệp cookies.txt (giúp vượt kiểm tra "bot" của YouTube).
  GROQ_API_KEY       mã API Groq (miễn phí) để nhận dạng giọng nói và dịch.
"""
import glob
import ipaddress
import os
import re
import shutil
import socket
import tempfile
from urllib.parse import quote, urlparse

import contextvars
import json
import subprocess
import time

import httpx
import yt_dlp
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from starlette.background import BackgroundTask

TOKEN = os.getenv("API_TOKEN", "")
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
MAX_MB = int(os.getenv("MAX_FILESIZE_MB", "500"))
MAX_MIN = int(os.getenv("MAX_DURATION_MIN", "90"))
COOKIES = os.getenv("COOKIES_FILE") or None
GROQ_KEY = os.getenv("GROQ_API_KEY", "")
GROQ = "https://api.groq.com/openai/v1"
_cur_key = contextvars.ContextVar("groq_key", default="")


def gkey() -> str:
    return _cur_key.get() or GROQ_KEY

app = FastAPI(title="Longtieng downloader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length", "X-Title", "X-Lang"],
)


def guard(req: Request, url: str) -> None:
    if TOKEN and req.headers.get("x-api-key") != TOKEN:
        raise HTTPException(401, "Sai mã truy cập máy chủ.")
    p = urlparse(url or "")
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(400, "Link không hợp lệ.")
    # Chặn link trỏ vào mạng nội bộ của máy chủ
    try:
        for info in socket.getaddrinfo(p.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise HTTPException(400, "Link không hợp lệ.")
    except socket.gaierror:
        raise HTTPException(400, "Không tìm thấy tên miền trong link.")


def base_opts(tmp: str | None = None) -> dict:
    o = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 3,
    }
    if COOKIES and os.path.exists(COOKIES):
        o["cookiefile"] = COOKIES
    if tmp:
        o["paths"] = {"home": tmp, "temp": tmp}
    return o


def friendly(e: Exception) -> str:
    m = str(e)
    if "Sign in to confirm" in m or "not a bot" in m:
        return "YouTube đang chặn máy chủ (kiểm tra bot). Thêm cookies cho máy chủ hoặc thử lại sau."
    if "Private video" in m or "private" in m.lower():
        return "Video riêng tư, không tải được."
    if "Unsupported URL" in m:
        return "Trang này chưa được hỗ trợ."
    if "File is larger" in m or "max_filesize" in m:
        return f"Video lớn hơn giới hạn {MAX_MB} MB."
    return "Không tải được video: " + re.sub(r"\x1b\[[0-9;]*m", "", m)[:300]


def get_info(url: str) -> dict:
    with yt_dlp.YoutubeDL(base_opts()) as y:
        info = y.extract_info(url, download=False)
    if info.get("_type") == "playlist" and info.get("entries"):
        info = next(e for e in info["entries"] if e)
    return info


def check_limits(info: dict) -> None:
    d = info.get("duration") or 0
    if d and d > MAX_MIN * 60:
        raise HTTPException(413, f"Video dài hơn giới hạn {MAX_MIN} phút.")


def safe_name(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|\n\r\t]+', " ", s or "video").strip()
    return (s[:80] or "video")


@app.get("/api/health")
def health():
    return {"ok": True, "yt_dlp": yt_dlp.version.__version__, "token": bool(TOKEN), "groq": bool(GROQ_KEY), "groq_from_app": True}


@app.get("/api/info")
def info(req: Request, url: str):
    guard(req, url)
    try:
        i = get_info(url)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(422, friendly(e))
    return {
        "title": i.get("title"),
        "duration": i.get("duration"),
        "thumbnail": i.get("thumbnail"),
        "site": i.get("extractor_key"),
        "language": i.get("language"),
        "subtitles": sorted((i.get("subtitles") or {}).keys()),
        "auto_subtitles": sorted((i.get("automatic_captions") or {}).keys())[:20],
    }


@app.get("/api/download")
def download(req: Request, url: str, q: int = 720):
    guard(req, url)
    q = max(144, min(int(q), 2160))
    tmp = tempfile.mkdtemp(prefix="lt_")
    try:
        try:
            i = get_info(url)
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        check_limits(i)
        opts = base_opts(tmp) | {
            "outtmpl": "video.%(ext)s",
            "format": "bv*+ba/b",
            # Ưu tiên H.264 + AAC để phát được trên iPhone
            "format_sort": [f"res:{q}", "vcodec:h264", "acodec:m4a", "ext:mp4"],
            "merge_output_format": "mp4",
            "max_filesize": MAX_MB * 1024 * 1024,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                y.download([i.get("webpage_url") or url])
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        files = [f for f in glob.glob(os.path.join(tmp, "video.*")) if not f.endswith((".part", ".ytdl"))]
        if not files:
            raise HTTPException(422, "Không tải được video (có thể quá giới hạn dung lượng).")
        path = max(files, key=os.path.getsize)
        title = safe_name(i.get("title"))
        ext = os.path.splitext(path)[1] or ".mp4"
        return FileResponse(
            path,
            media_type="video/mp4" if ext == ".mp4" else "application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(title + ext)}",
                "X-Title": quote(title),
            },
            background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True),
        )
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def pick_sub_lang(i: dict, prefer: list[str]) -> tuple[str, bool] | None:
    """Chọn ngôn ngữ phụ đề: ưu tiên phụ đề do người làm, sau đó mới tới tự động."""
    manual = i.get("subtitles") or {}
    auto = i.get("automatic_captions") or {}
    orig = (i.get("language") or "").split("-")[0]
    order = prefer + ([orig] if orig else []) + ["en"]
    for lang in order:
        for k in manual:
            if k == lang or k.split("-")[0] == lang:
                return k, False
    if manual:
        return next(iter(manual)), False
    for k in auto:
        if k.endswith("-orig"):
            return k, True
    for lang in ([orig] if orig else []) + ["en"] + prefer:
        if lang in auto:
            return lang, True
    return None


@app.get("/api/subs")
def subs(req: Request, url: str, prefer: str = "vi"):
    guard(req, url)
    try:
        i = get_info(url)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(422, friendly(e))
    choice = pick_sub_lang(i, [p.strip() for p in prefer.split(",") if p.strip()])
    if not choice:
        raise HTTPException(404, "Video này không có phụ đề.")
    lang, is_auto = choice
    tmp = tempfile.mkdtemp(prefix="lts_")
    try:
        opts = base_opts(tmp) | {
            "outtmpl": "sub.%(ext)s",
            "skip_download": True,
            "writesubtitles": not is_auto,
            "writeautomaticsub": is_auto,
            "subtitleslangs": [lang],
            "subtitlesformat": "vtt/srt/best",
            "postprocessors": [{"key": "FFmpegSubtitlesConvertor", "format": "srt"}],
        }
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                y.download([i.get("webpage_url") or url])
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        files = glob.glob(os.path.join(tmp, "*.srt")) or glob.glob(os.path.join(tmp, "*.vtt"))
        if not files:
            raise HTTPException(404, "Không lấy được phụ đề.")
        with open(files[0], encoding="utf-8", errors="replace") as f:
            text = f.read()
        return PlainTextResponse(text, headers={"X-Lang": lang + (" (tự động)" if is_auto else "")})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Nhận dạng giọng nói (Groq Whisper) và dịch (Groq LLM)
# ---------------------------------------------------------------------------
def need_groq(req: Request | None = None) -> None:
    k = (req.headers.get("x-groq-key") or "").strip() if req is not None else ""
    if k:
        _cur_key.set(k)
    if not gkey():
        raise HTTPException(503, "Chưa có mã Groq. Dán mã Groq trong app: Cài đặt → Máy chủ tải video → Mã Groq.")


def auth(req: Request) -> None:
    if TOKEN and req.headers.get("x-api-key") != TOKEN:
        raise HTTPException(401, "Sai mã truy cập máy chủ.")


def to_audio_chunks(src: str, tmp: str, chunk_sec: int = 1200) -> list[tuple[str, float]]:
    """Tách âm thanh mono 16 kHz, cắt mỗi đoạn 20 phút (giới hạn 25 MB/tệp của Groq miễn phí)."""
    pattern = os.path.join(tmp, "a_%03d.mp3")
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
         "-f", "segment", "-segment_time", str(chunk_sec), "-reset_timestamps", "1", pattern],
        capture_output=True, text=True, timeout=1800,
    )
    files = sorted(glob.glob(os.path.join(tmp, "a_*.mp3")))
    if r.returncode != 0 or not files:
        raise HTTPException(422, "Không tách được âm thanh: video không có tiếng hoặc định dạng lạ.")
    return [(f, i * chunk_sec) for i, f in enumerate(files)]


def whisper(path: str, lang: str | None) -> dict:
    data = {"model": "whisper-large-v3-turbo", "response_format": "verbose_json", "temperature": "0"}
    if lang:
        data["language"] = lang
    for attempt in range(4):
        with open(path, "rb") as f:
            r = httpx.post(f"{GROQ}/audio/transcriptions", headers={"Authorization": f"Bearer {gkey()}"},
                           data=data, files={"file": (os.path.basename(path), f, "audio/wav" if path.endswith(".wav") else "audio/mpeg")}, timeout=600)
        if r.status_code == 429:
            time.sleep(float(r.headers.get("retry-after", "10")) + 1)
            continue
        if r.status_code == 401:
            raise HTTPException(502, "Mã Groq không đúng, hãy kiểm tra lại.")
        if r.status_code >= 400:
            raise HTTPException(502, f"Groq báo lỗi khi nhận dạng giọng nói ({r.status_code}): {r.text[:200]}")
        return r.json()
    raise HTTPException(429, "Groq đang giới hạn lượt dùng, thử lại sau ít phút.")


def transcribe_file(src: str, tmp: str, lang: str | None) -> dict:
    segs, language = [], None
    for path, offset in to_audio_chunks(src, tmp):
        j = whisper(path, lang)
        language = language or j.get("language")
        for s in j.get("segments") or []:
            t = (s.get("text") or "").strip()
            if not t or s.get("no_speech_prob", 0) > 0.8:
                continue
            segs.append({"start": round(s["start"] + offset, 2), "end": round(s["end"] + offset, 2), "text": t})
    if not segs:
        raise HTTPException(422, "Không nghe thấy lời thoại nào trong video.")
    return {"language": language, "segments": segs}


@app.post("/api/transcribe")
def transcribe_upload(req: Request, file: UploadFile = File(...), lang: str | None = None):
    auth(req)
    need_groq(req)
    tmp = tempfile.mkdtemp(prefix="ltt_")
    try:
        src = os.path.join(tmp, "in" + (os.path.splitext(file.filename or "")[1] or ".mp4"))
        size = 0
        with open(src, "wb") as out:
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_MB * 1024 * 1024:
                    raise HTTPException(413, f"Video lớn hơn giới hạn {MAX_MB} MB.")
                out.write(chunk)
        return transcribe_file(src, tmp, lang)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.get("/api/transcribe")
def transcribe_url(req: Request, url: str, lang: str | None = None):
    guard(req, url)
    need_groq(req)
    tmp = tempfile.mkdtemp(prefix="ltu_")
    try:
        try:
            i = get_info(url)
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        check_limits(i)
        opts = base_opts(tmp) | {"outtmpl": "src.%(ext)s", "format": "ba/b", "max_filesize": MAX_MB * 1024 * 1024}
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                y.download([i.get("webpage_url") or url])
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        files = [f for f in glob.glob(os.path.join(tmp, "src.*")) if not f.endswith((".part", ".ytdl"))]
        if not files:
            raise HTTPException(422, "Không tải được âm thanh của video.")
        return transcribe_file(files[0], tmp, lang)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Dịch trực tiếp: tạo "phiên" giữ âm thanh trên máy chủ, app lấy từng đoạn
# ---------------------------------------------------------------------------
JOBS: dict = {}
JOB_TTL = 3 * 3600


def clean_jobs() -> None:
    now = time.time()
    for k in [k for k, j in JOBS.items() if now - j["t"] > JOB_TTL]:
        shutil.rmtree(JOBS.pop(k)["dir"], ignore_errors=True)


def new_job(src: str, tmp: str) -> dict:
    audio = os.path.join(tmp, "audio.mp3")
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", audio],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not os.path.exists(audio):
        raise HTTPException(422, "Không tách được âm thanh: video không có tiếng hoặc định dạng lạ.")
    try:
        os.remove(src)
    except OSError:
        pass
    pr = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio],
                        capture_output=True, text=True)
    dur = float((pr.stdout or "0").strip() or 0)
    jid = os.path.basename(tmp)
    JOBS[jid] = {"dir": tmp, "audio": audio, "duration": dur, "t": time.time()}
    return {"job": jid, "duration": dur}


@app.post("/api/live/upload")
def live_upload(req: Request, file: UploadFile = File(...)):
    auth(req)
    need_groq(req)
    clean_jobs()
    tmp = tempfile.mkdtemp(prefix="job")
    try:
        src = os.path.join(tmp, "in" + (os.path.splitext(file.filename or "")[1] or ".mp4"))
        size = 0
        with open(src, "wb") as out:
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_MB * 1024 * 1024:
                    raise HTTPException(413, f"Video lớn hơn giới hạn {MAX_MB} MB.")
                out.write(chunk)
        return new_job(src, tmp)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


@app.get("/api/live/start")
def live_start(req: Request, url: str):
    guard(req, url)
    need_groq(req)
    clean_jobs()
    tmp = tempfile.mkdtemp(prefix="job")
    try:
        try:
            i = get_info(url)
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        check_limits(i)
        opts = base_opts(tmp) | {"outtmpl": "src.%(ext)s", "format": "ba/b", "max_filesize": MAX_MB * 1024 * 1024}
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                y.download([i.get("webpage_url") or url])
        except yt_dlp.utils.DownloadError as e:
            raise HTTPException(422, friendly(e))
        files = [f for f in glob.glob(os.path.join(tmp, "src.*")) if not f.endswith((".part", ".ytdl"))]
        if not files:
            raise HTTPException(422, "Không tải được âm thanh của video.")
        return new_job(files[0], tmp)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


@app.get("/api/live/chunk")
def live_chunk(req: Request, job: str, start: float = 0, dur: float = 45, lang: str | None = None):
    auth(req)
    need_groq(req)
    j = JOBS.get(job)
    if not j:
        raise HTTPException(404, "Phiên dịch đã hết hạn, hãy bắt đầu lại.")
    j["t"] = time.time()
    start, dur = max(0.0, start), max(5.0, min(dur, 600.0))
    if start >= j["duration"]:
        return {"start": start, "end": start, "segments": [], "done": True, "duration": j["duration"]}
    part = os.path.join(j["dir"], f"c_{int(start * 1000)}.mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-t", str(dur), "-i", j["audio"],
                    "-ac", "1", "-ar", "16000", "-b:a", "32k", part], capture_output=True, timeout=120)
    end = min(start + dur, j["duration"])
    segs = []
    try:
        if os.path.exists(part) and os.path.getsize(part) > 1000:
            out = whisper(part, lang)
            for s in out.get("segments") or []:
                t = (s.get("text") or "").strip()
                if not t or s.get("no_speech_prob", 0) > 0.8:
                    continue
                segs.append({"start": round(start + s["start"], 2), "end": round(min(start + s["end"], end), 2), "text": t})
            lang_out = out.get("language")
        else:
            lang_out = None
    finally:
        try:
            os.remove(part)
        except OSError:
            pass
    return {"start": start, "end": end, "segments": segs, "language": lang_out,
            "done": end >= j["duration"] - 0.05, "duration": j["duration"]}


_llm_cache: dict = {}
LLM_PREFER = [m.strip() for m in os.getenv(
    "GROQ_LLM_MODELS", "openai/gpt-oss-120b,llama-3.3-70b-versatile,openai/gpt-oss-20b,llama-3.1-8b-instant").split(",") if m.strip()]


def llm_model() -> str:
    if _llm_cache.get("t", 0) > time.time() - 3600:
        return _llm_cache["m"]
    try:
        r = httpx.get(f"{GROQ}/models", headers={"Authorization": f"Bearer {gkey()}"}, timeout=20)
        ids = {m["id"] for m in r.json().get("data", [])}
        m = next((x for x in LLM_PREFER if x in ids), LLM_PREFER[0])
    except Exception:
        m = LLM_PREFER[0]
    _llm_cache.update(m=m, t=time.time())
    return m


def parse_json_array(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\n?|```$", "", text).strip()
    a, b = text.find("["), text.rfind("]")
    if a < 0 or b < 0:
        a, b = text.find("{"), text.rfind("}")
    j = json.loads(text[a:b + 1])
    if isinstance(j, dict):
        j = next((v for v in j.values() if isinstance(v, list)), [])
    return j


def build_prompt(items, prev=None, tone=None, context=None, roles=None) -> str:
    return (
        "Bạn là biên dịch viên lồng tiếng chuyên nghiệp. Dịch các câu thoại sau sang tiếng Việt để đọc lồng tiếng.\n"
        f"- Văn phong: {tone or 'tự nhiên, như lời nói đời thường'}.\n"
        + (f"- Bối cảnh: {context}\n" if context else "")
        + "- Xưng hô phù hợp, nhất quán. Giữ nguyên tên riêng.\n"
        "- Mỗi câu phải đọc vừa trong \"sec\" giây (~14 ký tự/giây): ngắn gọn, tự nhiên khi nói.\n"
        "- Không thêm chú thích. Giữ đúng số câu và id.\n"
        + (f"- Gán \"role\" là số nhân vật nói câu đó, chọn trong: {roles}. Không rõ thì 0.\n" if roles else "")
        + (f"Các câu trước (tham khảo): {json.dumps(prev, ensure_ascii=False)}\n" if prev else "")
        + f"Dữ liệu: {json.dumps(items, ensure_ascii=False)}\n\n"
        + 'Chỉ trả về JSON dạng {"items":[{"id":số,"vi":"bản dịch"' + (',"role":số' if roles else "") + "}]}."
    )


def translate_items(items, prev=None, tone=None, context=None, roles=None) -> list:
    prompt = build_prompt(items, prev, tone, context, roles)
    model = llm_model()
    for attempt in range(4):
        r = httpx.post(f"{GROQ}/chat/completions", headers={"Authorization": f"Bearer {gkey()}"}, timeout=120, json={
            "model": model, "temperature": 0.3,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": prompt}],
        })
        if r.status_code == 429:
            time.sleep(min(float(r.headers.get("retry-after", "5")) + 0.5, 20))
            continue
        if r.status_code >= 400:
            raise HTTPException(502, f"Groq báo lỗi khi dịch ({r.status_code}): {r.text[:200]}")
        try:
            out = parse_json_array(r.json()["choices"][0]["message"]["content"])
            return [o for o in out if isinstance(o, dict) and "id" in o and "vi" in o]
        except Exception:
            continue
    raise HTTPException(502, "Không dịch được lúc này, thử lại sau.")


@app.post("/api/translate")
async def translate(req: Request):
    auth(req)
    need_groq(req)
    body = await req.json()
    items = body.get("items") or []
    if not items or len(items) > 80:
        raise HTTPException(400, "Mỗi lần dịch từ 1 đến 80 câu.")
    key = gkey()

    def run():
        _cur_key.set(key)
        return translate_items(items, body.get("prev"), body.get("tone"), body.get("context"), body.get("roles"))

    return {"items": await run_in_threadpool(run)}


# Câu Whisper hay "bịa" ra khi đoạn âm thanh gần như im lặng
HALLU = re.compile(r"(subscribe|đăng ký kênh|cảm ơn các bạn đã (xem|theo dõi)|thanks for watching|thank you for watching|"
                   r"ご視聴ありがとう|字幕|amara\.org|點贊|订阅)", re.I)


@app.post("/api/interpret")
def interpret(req: Request, file: UploadFile = File(...), lang: str | None = Form(None), prev: str | None = Form(None),
              tone: str | None = Form(None), context: str | None = Form(None)):
    """Phiên dịch tức thời: nhận một đoạn âm thanh ngắn (vài giây), trả về lời gốc + bản dịch."""
    auth(req)
    need_groq(req)
    tmp = tempfile.mkdtemp(prefix="itp_")
    try:
        path = os.path.join(tmp, "clip" + (os.path.splitext(file.filename or "")[1] or ".wav"))
        data = file.file.read(30 * 1024 * 1024)
        with open(path, "wb") as f:
            f.write(data)
        out = whisper(path, lang or None)
        language = out.get("language")
        segs = []
        for s in out.get("segments") or []:
            t = (s.get("text") or "").strip()
            if not t or s.get("no_speech_prob", 0) > 0.6 or s.get("avg_logprob", 0) < -1.2 or HALLU.search(t):
                continue
            segs.append({"start": round(s["start"], 2), "end": round(s["end"], 2), "src": t})
        if not segs:
            return {"language": language, "items": []}
        is_vi = (lang or "").startswith("vi") or str(language).lower() in ("vi", "vietnamese")
        if is_vi:
            for s in segs:
                s["vi"] = s["src"]
        else:
            try:
                prev_list = json.loads(prev) if prev else None
            except ValueError:
                prev_list = None
            items = [{"id": i, "sec": round(s["end"] - s["start"], 1), "text": s["src"]} for i, s in enumerate(segs)]
            for o in translate_items(items, prev_list, tone, context):
                if 0 <= int(o["id"]) < len(segs):
                    segs[int(o["id"])]["vi"] = str(o["vi"]).strip()
            for s in segs:
                s.setdefault("vi", s["src"])
        return {"language": language, "items": segs}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.exception_handler(HTTPException)
def http_err(_req, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
