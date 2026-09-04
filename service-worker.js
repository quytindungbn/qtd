// Service worker TỐI GIẢN — mục đích DUY NHẤT là để Chrome/Android coi trang này
// là "có thể cài đặt" (điều kiện bắt buộc để "Thêm vào màn hình chính" mở ra
// KHÔNG có thanh địa chỉ, chạy như 1 app riêng, thay vì chỉ tạo 1 shortcut mở
// trong Chrome bình thường). KHÔNG cache gì cả — app đang phát triển liên tục,
// cache ở đây dễ làm người dùng bị kẹt xem code cũ sau khi có bản cập nhật.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  // cache: 'no-store' ép trình duyệt LUÔN xin bản mới nhất từ server, không tự
  // ý dùng file đã lưu trước đó — tránh tình trạng "đã đẩy code mới nhưng mở
  // app vẫn thấy bản cũ" ở tab thường (trong khi ẩn danh thì luôn đúng vì
  // ẩn danh không có cache).
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
