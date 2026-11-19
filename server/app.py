"""Máy chủ tải video cho app Lồng tiếng Việt.

Dùng yt-dlp để tải video và phụ đề từ link (YouTube, TikTok, Facebook, ...),
trả về cho app chạy trong trình duyệt.

Biến môi trường:
  API_TOKEN          mã truy cập (khuyên dùng). App gửi qua header X-Api-Key.
  ALLOWED_ORIGINS    các nguồn được gọi, phân tách dấu phẩy. Mặc định "*".
  MAX_FILESIZE_MB    dung lượng video tối đa. Mặc định 500.
  MAX_DURATION_MIN   thời lượng video tối đa (phút). Mặc định 90.
  COOKIES_FILE       đường dẫn tệp cookies.txt (giúp vượt kiểm tra "bot" của YouTube).
"""
import glob
import ipaddress
import os
import re
import shutil
import socket
import tempfile
from urllib.parse import quote, urlparse

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from starlette.background import BackgroundTask

TOKEN = os.getenv("API_TOKEN", "")
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
MAX_MB = int(os.getenv("MAX_FILESIZE_MB", "500"))
MAX_MIN = int(os.getenv("MAX_DURATION_MIN", "90"))
COOKIES = os.getenv("COOKIES_FILE") or None

app = FastAPI(title="Longtieng downloader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET"],
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
    return {"ok": True, "yt_dlp": yt_dlp.version.__version__, "token": bool(TOKEN)}


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


@app.exception_handler(HTTPException)
def http_err(_req, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
