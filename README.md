# Lồng tiếng Việt cho video

Ứng dụng web chạy hoàn toàn trong trình duyệt: nạp video + phụ đề gốc, dịch sang tiếng Việt, rồi đọc giọng tiếng Việt khớp theo thời gian video.

## Tính năng
- Nạp video từ máy (MP4 / WebM / MOV)
- Đọc phụ đề `.srt`, `.vtt` hoặc văn bản thường (tự chia đều theo thời lượng video)
- Dịch sang tiếng Việt bằng Claude (khi mở trong Claude), chọn văn phong và bối cảnh
- Sửa từng câu dịch, cảnh báo câu quá dài so với thời lượng
- Lồng tiếng bằng giọng tiếng Việt của thiết bị (Web Speech API)
  - Tự tăng tốc đọc để vừa khung thời gian
  - Tự hạ âm gốc khi có thoại
  - Tạm dừng video nếu câu trước đọc chưa xong
- Hiện phụ đề tiếng Việt (và phụ đề gốc) trên video
- Xuất / sao chép tệp SRT tiếng Việt

## Chạy
Mở `index.html` bằng trình duyệt, hoặc bật **GitHub Pages** (Settings → Pages → Deploy from branch `main`, thư mục `/root`).

## Lưu ý
- Ngoài môi trường Claude, nút **Dịch bằng Claude** sẽ bị tắt. Bạn có thể nạp sẵn tệp SRT tiếng Việt hoặc sửa tay từng câu.
- Cần cài giọng tiếng Việt cho thiết bị:
  - iPhone: Cài đặt → Trợ năng → Nội dung được đọc → Giọng nói → Tiếng Việt
  - Android: Cài đặt → Chuyển văn bản thành giọng nói → tải gói tiếng Việt
- App không tự nhận dạng lời nói trong video, nên cần có phụ đề gốc.
- Giọng lồng tiếng phát trực tiếp khi xem, không ghi được thành tệp video mới.
