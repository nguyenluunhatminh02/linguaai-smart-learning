# Kế hoạch 12 tuần cải thiện LinguaAI cho người Việt học tiếng Anh giao tiếp

**Ưu tiên đầu tiên là giúp người học vào được bài, nhận kết quả đúng và tìm lại được những gì đã học.** Sau đó, nối các tính năng nghe, nói và ôn thẻ thành một hành trình giao tiếp hằng ngày. Với một người triển khai trong ba tháng, mục tiêu khả thi là hoàn thiện sáu tình huống A1–A2 và kiểm chứng chúng với người học thật.

Tệp Markdown dự kiến: `docs/ke-hoach-cai-thien-trai-nghiem-nguoi-hoc.md`. Phiên hiện tại đang ở chế độ lập kế hoạch nên nội dung bên dưới chưa được ghi vào kho mã.

## 1. Những điểm cần sửa từ dự án hiện tại

Mình đã đối chiếu giao diện Next.js, API NestJS, dịch vụ AI FastAPI, dữ liệu Prisma và CMS, tài liệu đồ án cùng các bài kiểm thử. **Cả 40 kiểm thử đơn vị đã chạy cho thuật toán FSRS và dịch vụ ôn thẻ đều đạt.** Tuy nhiên, bài kiểm thử trình duyệt cho phiên ôn hiện dừng ở bước mở danh sách bộ thẻ. Các phát hiện dưới đây dựa trên mã nguồn và dữ liệu trong dự án. Chưa có số liệu về tỷ lệ người học thực tế gặp từng vấn đề.

| Mức | Phát hiện | Ảnh hưởng đến người học |
|---|---|---|
| P0 | Email đăng ký dẫn đến `/verify-email`, nhưng web chưa có trang này. Ngoài môi trường phát triển, API yêu cầu tài khoản đã xác minh. | Người mới có thể bị chặn trước bài đầu tiên. |
| P0 | Trang ôn thẻ vẫn chuyển thẻ khi lưu thất bại. Khi kết thúc phiên, web thiếu `cardsCorrect` và `durationSeconds` mà API yêu cầu. Trang quiz gọi `/quiz/:id/submit`, trong khi API nhận `/quiz/submit`, rồi tự chấm trên trình duyệt khi yêu cầu lỗi. | Người học thấy điểm hoặc thông báo hoàn thành nhưng lịch sử có thể không ghi nhận công sức của họ. |
| P0 | Khi chạy lại seed, mã hiện tại xóa và tạo lại thẻ trong các bộ thẻ mẫu. Tiến độ ôn gắn với thẻ cũ bị xóa theo. | Một lần cập nhật giáo trình có thể làm mất lịch ôn của người đang học. |
| P0 | Bài đọc mẫu *Morning Routine* lưu đáp án `7:00` dưới dạng chữ, còn giao diện so sánh theo vị trí. Trang nghe có trường hợp mặc định đáp án đầu tiên khi không hiểu định dạng. | Người học có thể trả lời đúng và nhận phản hồi sai. |
| P1 | Dashboard nhận được mã bộ thẻ và thông tin bài gợi ý nhưng nút bấm chỉ mở trang danh mục. Với người mới, gợi ý đọc mặc định ở B1. Mục tiêu trên trang Goals lưu theo trình duyệt. | Người mới phải tự chọn bài lần nữa. Khi đổi thiết bị, mục tiêu đã đặt có thể biến mất. |
| P1 | Luồng YouTube có thể sinh lời thoại từ tiêu đề video. Luồng nói tự do yêu cầu AI chấm phát âm từ bản chép lời. Trong bản JSON dự phòng có 42 bài tiếng Anh công khai của hệ thống, nhưng chưa có bài nghe A1. | Người mới thiếu bài nghe vừa sức. Câu hỏi có thể lệch khỏi điều họ vừa nghe, còn điểm nói có thể khiến họ luyện sai trọng tâm. |

## 2. Trải nghiệm người học cần đạt

Ví dụ, một người chọn **“Mình mới bắt đầu, có 10 phút mỗi ngày”**. Trang chủ mở thẳng bài **Gọi món ở quán**. Người học nghe câu *“For here or to go?”*, chọn ý nghĩa, rồi tự trả lời *“To go, please.”* Nếu gặp khó, họ có thể nghe lại hoặc xem gợi ý tiếng Việt. Cuối bài, họ lưu mẫu câu muốn nhớ. Khi quay lại, LinguaAI mở đúng thẻ đến hạn và cho dùng câu đó trong tình huống mua đồ ăn khác.

Mỗi bài có một kết quả người học tự kiểm tra được, chẳng hạn **“Tôi có thể gọi một món và nói mình muốn mang đi.”** Cách đặt mục tiêu này dựa trên mô tả năng lực “có thể làm gì” của CEFR. Việc yêu cầu người học tự nhớ trước khi xem đáp án và gặp lại mẫu câu sau một khoảng nghỉ dựa trên hướng dẫn về luyện nhớ và ôn cách quãng. [Mô tả năng lực CEFR của Hội đồng châu Âu](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors) · [Hướng dẫn của Institute of Education Sciences](https://ies.ed.gov/ncee/wwc/PracticeGuide/1)

## 3. Lộ trình cho một người triển khai

| Thời gian | Công việc | Điều kiện hoàn thành |
|---|---|---|
| **Tuần 1–2** | Hoàn thiện trang xác minh email và gửi lại liên kết. Sửa luồng nộp quiz, lưu từng thẻ và kết thúc phiên. Thêm trạng thái đang lưu, cho thử lại khi mất mạng và ngăn ghi hai lần. | Đăng ký bằng email mới trên môi trường thử nghiệm, xác minh, làm quiz và ôn một bộ thẻ. Tải lại vẫn thấy đúng điểm và số thẻ. Mất mạng ở thẻ cuối rồi gửi lại chỉ tạo một kết quả. |
| **Tuần 3–4** | Giữ mã thẻ ổn định khi cập nhật giáo trình. Chuẩn hóa đáp án từ PostgreSQL, JSON và AI trước khi chấm. Sửa trang Từ khó để hiện nghĩa thật và giữ thẻ vừa quên trong luồng học lại. | Chạy seed hai lần trên cơ sở dữ liệu thử vẫn giữ lịch ôn cũ. Chọn `7:00` trong *Morning Routine* được chấm đúng. Sau chuỗi “Nhớ → Quên → Nhớ”, người học xem được nghĩa và lịch ôn tiếp theo. |
| **Tuần 5–6** | Thêm bước chọn trình độ tự đánh giá và thời lượng 5, 10 hoặc 15 phút, cho phép bỏ qua. Lưu theo tài khoản. Dashboard có một nút **Học tiếp** mở đúng bài hoặc bộ thẻ. Dùng lịch sử quiz thật để đề xuất luyện tập. | Tài khoản mới bỏ qua thiết lập được vào một bài A1. Tài khoản cũ tiếp tục đúng bài. Đổi thiết bị vẫn giữ mục tiêu và tiến độ. Nút học tiếp dùng được trên điện thoại và bằng bàn phím. |
| **Tuần 7–9** | Biên soạn sáu tình huống bằng CMS hiện có. A1 gồm chào hỏi, gọi món và mua hàng. A2 gồm hỏi đường, hẹn gặp và đổi lịch. Mỗi bài có hội thoại ngắn, âm thanh khớp lời, câu hỏi hiểu ý, một lượt tự trả lời và nút **Ôn câu này**. | Cả sáu bài có thể hoàn thành bằng nội dung đã duyệt khi dịch vụ AI gián đoạn. Khi người học lưu một câu hai lần, bộ thẻ chỉ có một bản kèm ngữ cảnh và nghĩa tiếng Việt. |
| **Tuần 10–12** | Chỉnh phản hồi nói để người học biết từ nào hệ thống nhận ra, có thể nghe lại và thử lần nữa. Với video YouTube, chỉ sinh câu hỏi khi có bản chép lời thực. Thử sản phẩm với 8 người học và dành tuần cuối sửa các điểm họ mắc lặp lại. | Người học có thể đối chiếu phản hồi với câu đã nói. Video chỉ có tiêu đề sẽ yêu cầu bổ sung lời thoại trước khi tạo bài. Hoàn thành hai lượt thử cách nhau khoảng một tuần để kiểm tra khả năng dùng lại mẫu câu. |

## 4. Thay đổi kỹ thuật và cách đo kết quả

- **Dùng một kết quả chính thức cho mỗi lượt học.** Web gửi quiz qua `POST /quiz/submit` với `quizId`, từng cặp `questionId`–`answer` và thời lượng. Phiên ôn gửi đủ dữ liệu API yêu cầu. Mỗi lượt nộp có mã riêng để máy chủ nhận biết khi gửi lại. Chỉ hiển thị “Đã lưu” sau khi máy chủ xác nhận.
- **Nối bài học với tiến độ hiện có.** Bổ sung bản ghi hoàn thành bài nghe/đọc theo tài khoản và mã bài. Dashboard dùng bản ghi này cùng lịch FSRS để mở đúng hoạt động tiếp theo. Tách ngày có học khỏi ngày chỉ điểm danh. Tài khoản cũ tiếp tục dùng được trước khi bổ sung sở thích.
- **Đo người học bắt đầu có dễ không.** Mục tiêu thử nghiệm là ít nhất **6/8 người** tự mở và hoàn thành bài đầu mà không cần người hướng dẫn. Ghi lại thời gian từ lúc đăng nhập đến lúc bắt đầu nghe và bước đầu tiên khiến họ dừng lại.
- **Đo khả năng giao tiếp sau một tuần.** Cho mỗi người xử lý hai biến thể chưa gặp, chẳng hạn đổi món và đổi hình thức dùng tại quán. Ghi riêng số người quay lại, số người truyền đạt đủ ý mà không xem mẫu và lỗi phổ biến. Với nhóm tám người, báo cáo số đếm thực tế cùng ví dụ quan sát được.
- **Điều kiện mở rộng.** Chỉ bổ sung tình huống mới sau khi các ca đăng ký, chấm đúng, lưu phiên, gửi lại và cập nhật giáo trình đều đạt. Nếu thiếu thời gian, ưu tiên bốn bài đầu được thử với người học. Hai bài còn lại là phần có thể dời. Các cải tiến cho tiếng Trung, tiếng Nhật, chat tự do và chấm viết được xếp sau đợt tiếng Anh giao tiếp này.
