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
