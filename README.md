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

## Tự lồng tiếng khi xem YouTube (userscript)
Tiện ích [`userscript/longtieng.user.js`](userscript/longtieng.user.js) chạy ngay trên trang YouTube: một nút cam hiện ở góc màn hình, bấm **Bắt đầu lồng tiếng** là video được đọc bằng giọng Việt, khớp theo thời gian, kèm phụ đề tiếng Việt.

- Lấy phụ đề của video. Nếu không có phụ đề tiếng Việt, dùng tính năng tự dịch của YouTube.
- Chọn giọng, phong cách, tốc độ, mức âm gốc; tự dừng video chờ đọc xong câu.
- Tự chạy lại khi bạn chuyển sang video khác.

### Cài trên iPhone / iPad (Safari)
1. Cài app miễn phí **Userscripts** (tác giả Justin Wasack) từ App Store.
2. Mở app Userscripts → chọn một thư mục để lưu script (ví dụ thư mục Userscripts trong Tệp).
3. Vào **Cài đặt → Safari → Tiện ích mở rộng → Userscripts** → bật lên, phần *Quyền* chọn **Cho phép** với `youtube.com`.
4. Mở bằng Safari: <https://raw.githubusercontent.com/iamboo98/longtieng/main/userscript/longtieng.user.js>
5. Chạm biểu tượng **ᴀA** (hoặc 🧩) trên thanh địa chỉ → **Userscripts** → **Install** (Cài đặt).
6. Mở `m.youtube.com`, vào một video, chạm nút cam ở góc phải → **Bắt đầu lồng tiếng**.

### Cài trên máy tính
Cài tiện ích **Tampermonkey** cho Chrome / Edge / Firefox, rồi mở link ở bước 4 → **Install**.

### Lưu ý
- Chỉ chạy khi bạn đang mở trang và màn hình đang sáng. Khoá máy hoặc chuyển app thì giọng đọc dừng.
- Không dùng chế độ toàn màn hình của iPhone (trình phát gốc của iOS che mất phụ đề và có thể làm dừng giọng đọc); xoay ngang trong trang vẫn được.
- Trên iPhone, Safari không cho chỉnh nhỏ âm gốc, nên khi đang đọc âm gốc sẽ tắt hẳn.
- Video không có phụ đề (kể cả phụ đề tự động) thì chưa lồng tiếng được.

## Dịch trực tiếp khi xem (không cần phụ đề)
Trên bản GitHub Pages, khi bạn chọn video hoặc dán link, app bật **chế độ dịch trực tiếp**:
1. Máy chủ lấy âm thanh của video (tải tệp lên, hoặc tự tải từ link).
2. Từng đoạn 25–60 giây được **Groq Whisper** nghe ra lời thoại rồi dịch sang tiếng Việt, luôn đi trước chỗ bạn đang xem khoảng 1 phút.
3. Bấm **▶ Phát lồng tiếng** ngay khi đoạn đầu xong (vài giây). Nếu bản dịch chưa theo kịp, video tự tạm dừng vài giây rồi phát tiếp.

Tiện ích YouTube cũng có chế độ này: trong bảng tiện ích chọn **Nguồn lời thoại → Tự nghe bằng máy chủ**, hoặc để mặc định — video không có phụ đề sẽ tự chuyển sang máy chủ. Nhập địa chỉ máy chủ và mã ở mục **Máy chủ** cuối bảng.

Cần đặt `GROQ_API_KEY` cho máy chủ: tạo tài khoản miễn phí tại <https://console.groq.com> → **API Keys** → **Create API Key**, rồi thêm vào Render → dịch vụ `longtieng-downloader` → **Environment**.

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
| `ALLOWED_ORIGINS` | Trang web được phép gọi máy chủ (thêm `https://www.youtube.com,https://m.youtube.com` cho tiện ích YouTube) | `*` |
| `MAX_FILESIZE_MB` | Dung lượng video tối đa | 500 |
| `MAX_DURATION_MIN` | Thời lượng tối đa (phút) | 90 |
| `GROQ_API_KEY` | Mã API Groq (miễn phí) để tự nghe lời thoại và dịch | trống (tắt) |
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
