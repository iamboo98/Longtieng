<p align="center"><img src="logo.svg" width="120" alt="Logo"></p>

# Lồng tiếng Việt cho video

Ứng dụng web chạy hoàn toàn trong trình duyệt: nạp video + phụ đề gốc, dịch sang tiếng Việt, rồi đọc giọng tiếng Việt khớp theo thời gian video.

## Tính năng
- Nạp video từ máy (MP4 / WebM / MOV) hoặc từ link: YouTube (video, Shorts), link trực tiếp tới tệp video, Google Drive, Dropbox
- Tự hạ âm gốc khi lồng tiếng, kể cả trên iPhone (với video chọn từ máy)
- Đọc phụ đề `.srt`, `.vtt` hoặc văn bản thường (tự chia đều theo thời lượng video)
- Dịch sang tiếng Việt bằng Claude (khi mở trong Claude), chọn văn phong và bối cảnh
- Sửa từng câu dịch, cảnh báo câu quá dài so với thời lượng
- Nhiều nhân vật (tối đa 6), mỗi nhân vật chọn giọng và phong cách riêng: Tự nhiên, Nam trầm, Nam trẻ, Nữ trong trẻo, Nữ dịu dàng, Trẻ em, Người già, Tin tức, Kể chuyện, Hào hứng, Thì thầm, Hoạt hình, Robot
- Chạm chấm màu ở đầu câu để đổi nhân vật; khi dịch bằng Claude có thể tự nhận biết người nói
- Chọn mọi giọng tiếng Việt trên thiết bị (ưu tiên giọng tự nhiên ★), giọng đa ngôn ngữ và giọng Claude
- Lồng tiếng bằng Web Speech API
  - Tự tăng tốc đọc để vừa khung thời gian
  - Tự hạ âm gốc khi có thoại
  - Tạm dừng video nếu câu trước đọc chưa xong
- Hiện phụ đề tiếng Việt (và phụ đề gốc) trên video
- Xuất / sao chép tệp SRT tiếng Việt

## Tải video từ link bất kỳ
Nút **🔗 Link → ⬇ Tải video** tải video từ YouTube, TikTok, Facebook, Instagram, X và hơn 1000 trang khác, rồi tự lấy phụ đề có sẵn của video. Tính năng này cần **máy chủ tải video** (thư mục [`server/`](server/), dùng [yt-dlp](https://github.com/yt-dlp/yt-dlp)).

### Triển khai miễn phí trên Render
1. Đăng nhập [render.com](https://render.com) bằng GitHub.
2. **New → Blueprint** → chọn repo `longtieng` → **Apply**. Render đọc `render.yaml` và tự dựng máy chủ.
3. Khi xong, mở dịch vụ `longtieng-downloader`:
   - Copy địa chỉ (dạng `https://longtieng-downloader.onrender.com`).
   - Vào **Environment**, copy giá trị `API_TOKEN`.
4. Trong app: **Cài đặt → Máy chủ tải video** → dán địa chỉ và mã → **Kiểm tra kết nối**.

### Chạy trên máy tính
```bash
cd server
docker build -t longtieng-dl . && docker run -p 8000:8000 -e API_TOKEN=matkhau longtieng-dl
# hoặc không dùng Docker (cần ffmpeg):
pip install -r requirements.txt && uvicorn app:app --port 8000
```

### Biến môi trường
| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `API_TOKEN` | Mã truy cập, app gửi qua header `X-Api-Key` | trống (không kiểm tra) |
| `ALLOWED_ORIGINS` | Trang web được phép gọi máy chủ | `*` |
| `MAX_FILESIZE_MB` | Dung lượng video tối đa | 500 |
| `MAX_DURATION_MIN` | Thời lượng tối đa (phút) | 90 |
| `COOKIES_FILE` | Tệp cookies.txt, giúp vượt kiểm tra "bot" của YouTube | trống |

### Lưu ý
- Gói miễn phí của Render ngủ khi không dùng; lần gọi đầu có thể mất khoảng 1 phút.
- YouTube hay chặn máy chủ đám mây ("Sign in to confirm you're not a bot"). Khi đó cần thêm `COOKIES_FILE`, hoặc chạy máy chủ trên máy tính ở nhà.
- Chỉ tải video bạn có quyền sử dụng, và tôn trọng điều khoản của từng trang.

## Chạy
Mở `index.html` bằng trình duyệt, hoặc bật **GitHub Pages** (Settings → Pages → Deploy from branch `main`, thư mục `/root`).

## Lưu ý
- Link video và YouTube chỉ chạy trên bản GitHub Pages / mở trực tiếp `index.html`; bản mở trong Claude chỉ phát được video chọn từ máy.
- TikTok, Facebook, Instagram không cho phát nhúng: hãy tải video về máy rồi chọn tệp.
- Trên iPhone, với YouTube có thể cần chạm vào video một lần trước khi bấm Phát lồng tiếng.
- Ngoài môi trường Claude, nút **Dịch bằng Claude** sẽ bị tắt. Bạn có thể nạp sẵn tệp SRT tiếng Việt hoặc sửa tay từng câu.
- Cần cài giọng tiếng Việt cho thiết bị:
  - iPhone: Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Việt
  - Android: Cài đặt → Chuyển văn bản thành giọng nói → tải gói tiếng Việt
- App không tự nhận dạng lời nói trong video, nên cần có phụ đề gốc.
- Giọng lồng tiếng phát trực tiếp khi xem, không ghi được thành tệp video mới.
