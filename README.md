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

## 🎭 Đạo diễn lồng tiếng tự động (sát tính chất và nội dung video)
Khi dùng máy chủ, mỗi video được "đạo diễn" tự động để giọng Việt khớp với video gốc:
- **Hiểu video**: sau vài câu đầu, máy chủ phân tích tiêu đề + lời thoại để biết thể loại (phim, hoạt hình, tin tức, vlog, review, game, bài giảng…), văn phong nên dùng, cách xưng hô giữa các nhân vật / với khán giả, và thuật ngữ cần dịch thống nhất. Toàn bộ phần dịch sau đó theo "hồ sơ" này. App hiện hồ sơ ở dòng 🎯.
- **Đúng người nói**: đo cao độ giọng gốc từng câu → nam dùng NamMinh, nữ dùng HoaiMy, trẻ em giọng cao hơn. Các người nói khác nhau (cùng giới) được tách ra và giữ một giọng riêng (cao độ, nhịp khác nhau) suốt video.
- **Đúng cảm xúc**: mỗi câu được gán cảm xúc (vui, hào hứng, buồn, giận, sợ, ngạc nhiên, thì thầm, nghiêm túc, dịu dàng, mỉa mai, hét) → đổi tốc độ, cao độ, âm lượng. Câu gốc nói to thì giọng Việt cũng to hơn.
- **Đúng nhịp**: tin tức, thể thao đọc nhanh hơn; tài liệu, kể chuyện chậm hơn; mỗi câu được tự tăng tốc vừa với thời lượng câu gốc ngay khi tạo giọng (không méo tiếng).

Bật / tắt: **Cài đặt → 🎭 Đạo diễn tự động** (app web), hoặc ô 🎭 trong bảng tiện ích. Chỉ áp dụng cho nhân vật để giọng **Tự động**; muốn tự chọn giọng thì chọn giọng cụ thể cho nhân vật. **Văn phong → 🎯 Tự động theo thể loại video** là mặc định; chọn văn phong khác để ghi đè.

## 🌐 Lồng tiếng trên mọi trang web (userscript)
Tiện ích [`userscript/longtieng-web.user.js`](userscript/longtieng-web.user.js) chạy trên mọi trang có video (Facebook, TikTok, Vimeo, Bilibili, báo điện tử, khoá học online…): nút 🎙️ hiện ở góc khi trang có video, bấm **Bắt đầu lồng tiếng** là video được nghe, dịch và đọc giọng Việt ngay khi đang xem.

- **Cài**: Tampermonkey (máy tính) hoặc app Userscripts (iPhone/iPad), mở <https://raw.githubusercontent.com/iamboo98/longtieng/main/userscript/longtieng-web.user.js> → **Install**. Khi Tampermonkey hỏi quyền kết nối tới máy chủ, chọn **Always allow**.
- Nhập địa chỉ máy chủ, mã truy cập và mã Groq một lần ở **Cài đặt máy chủ** — dùng chung cho mọi trang.
- **Cách lấy lời thoại**:
  - *Nghe tiếng video đang phát* (⚡, trễ 3–5 giây): dùng được với hầu hết trình phát web.
  - *Máy chủ lấy từ link trang* (khớp nhất): máy chủ tự tải âm thanh từ địa chỉ trang bằng yt-dlp và dịch trước. Dùng khi trang không cho nghe tiếng video.
  - *Tự động*: thử nghe trước, không được thì nhờ máy chủ.
- Video có DRM (Netflix, Disney+, …) không nghe được tiếng và yt-dlp cũng không tải được, nên chưa hỗ trợ.
- YouTube dùng tiện ích riêng bên dưới (có thêm chế độ đọc phụ đề không cần máy chủ).

## 🤖 Giọng AI tự nhiên
Khi có máy chủ, app và tiện ích tự đọc bằng giọng AI tiếng Việt của Microsoft (thư viện edge-tts): **HoaiMy** (nữ) và **NamMinh** (nam) — tự nhiên như người thật, không cần cài giọng trên máy, không cần tài khoản. Nhân vật nam (Nam trầm, Nam trẻ, Người già…) dùng NamMinh, nhân vật nữ và trẻ em dùng HoaiMy với cao độ khác nhau. Có thể tắt trong **Cài đặt → Giọng AI tự nhiên** để dùng giọng của máy.

Lưu ý: edge-tts dùng dịch vụ đọc của Microsoft Edge không chính thức, có thể ngừng hoạt động bất cứ lúc nào; khi đó app tự quay về giọng của máy.

## ⚡ Phiên dịch tức thời
Chế độ mặc định khi chọn video từ máy (hoặc video tải qua máy chủ): bấm **▶ Phát lồng tiếng** là video chạy ngay. App nghe tiếng video đang phát, cắt theo chỗ ngắt câu (2,5–8 giây), gửi đoạn ngắn lên máy chủ để Groq nghe + dịch, rồi đọc giọng Việt ngay — giống phiên dịch viên, trễ khoảng 3–5 giây so với lời gốc. Không tải trước, không chờ, không dừng giữa chừng.

Tiện ích YouTube có cùng chế độ: **Nguồn lời thoại → ⚡ Phiên dịch tức thời**.

Lưu ý: gói miễn phí của Groq tính tối thiểu 10 giây cho mỗi đoạn, đủ cho khoảng 1 giờ phiên dịch mỗi giờ.

## Dịch trước (khớp chính xác)
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
- Không có máy chủ thì app không tự nhận dạng lời nói trong video, nên cần có phụ đề gốc.
- Giọng lồng tiếng phát trực tiếp khi xem, không ghi được thành tệp video mới.
