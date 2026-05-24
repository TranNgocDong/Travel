# TrailLedger Cockpit UI Plan

## Vấn đề giao diện hiện tại

- Màn bên trong đang có nhiều khối xuất hiện cùng lúc nên người dùng dễ bị ngợp khi đang đi đường.
- Bản đồ chưa đủ nổi bật so với chi phí, nhóm, tổng kết và các thẻ trạng thái.
- Chat đã là bong bóng nổi, nhưng bottom navigation và bản đồ vẫn cần rõ vai trò hơn trên mobile.
- Phần thành viên nên gọi bằng ngôn ngữ đời thường hơn: "Nhóm đang đi" thay vì "Hiện diện".

## Hướng layout mới

### Mobile

- Mặc định mở vào tab `Bản đồ`.
- Bottom navigation cố định gồm: `Bản đồ`, `Chi phí`, `Nhóm`, `Tổng kết`.
- Ở tab `Bản đồ`, ẩn bớt tổng quan, vòng đời chuyến, đồng bộ để bản đồ và tuyến đường là trung tâm.
- Chat nổi phía trên bottom navigation để không che nút điều hướng.

### Desktop

- Giữ app shell hiện tại nhưng mở rộng vùng bản đồ trên tab `Bản đồ`.
- Side panel chỉ giữ các thông tin cần khi đi đường: điểm cần chú ý, địa điểm gần tuyến, GPS nhóm, đánh dấu map.
- Các tab `Chi phí`, `Nhóm`, `Tổng kết` vẫn tách riêng để tránh nhồi một màn.

## Component cần tiếp tục tách nhỏ

- `CockpitMapScreen`: gom bản đồ, GPS nhóm, POI gần tuyến và đánh dấu map.
- `GroupRidePanel`: thay cho phần hiện diện, tập trung vào người đang online và thao tác đi gặp.
- `ExpenseWorkspace`: gom nhập chi phí, danh sách chi phí, ai trả ai.
- `TripRecapScreen`: tổng kết sau chuyến, lưu trữ/xóa chuyến.
- `FloatingChatDock`: giữ dạng bong bóng, thêm trạng thái tin mới rõ hơn.

## Thứ tự triển khai

1. Bước 1 đã làm: map-first CSS, bottom navigation cố định trên mobile, đổi "Hiện diện" thành "Nhóm đang đi".
2. Bước 2: tách tab `Bản đồ` thành cockpit screen riêng để dễ kiểm soát layout.
3. Bước 3: làm bottom sheet kéo lên/xuống cho POI, GPS nhóm và điểm đánh dấu.
4. Bước 4: làm lại tab `Chi phí` thành màn nhập/chia tiền gọn hơn.
5. Bước 5: làm lại `Tổng kết` sau chuyến theo dạng báo cáo chuyến đi.
