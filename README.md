# Kiểm kê Foremost

App kiểm kê tài sản và nguyên liệu cho 3 cửa hàng Foremost VN (Mỹ Đình, Huỳnh Thúc Kháng, Aeon Hà Đông).

- Link: https://ngtminh0101-arch.github.io/kiem-ke-foremost/
- Dữ liệu và đăng nhập: Firebase (dự án `kiemke-foremost`, Firestore + đăng nhập Google).
- `config.js`: cấu hình web của Firebase (được phép công khai).
- Quy tắc bảo mật Firestore nằm trong Firebase Console (Firestore → Rules), không nằm trong kho này.
- Quản trị thêm người dùng trong app: mục **Tài khoản được phép**.

## Kiểm kê Bakery (`bakery/`)

App kiểm kê nguyên liệu và bán thành phẩm cho Bakery, chạy cùng dự án Firebase nhưng có **danh sách tài khoản riêng** (`bk_roles/main`), không dính với app Foremost. Chủ sở hữu (`ownerEmail()` trong quy tắc) luôn là quản trị.

- Link: https://kiemke-foremost.web.app/bakery/
- Dữ liệu Firestore: `bk_cfg/main` (kỳ), `bk_dm/nvl`, `bk_dm/btp` (danh mục, lưu dạng chuỗi JSON), `bk_c/<uid>` (số đếm, mã mới, đơn vị, ảnh của từng người), `bk_ph/<id>` (ảnh thực tế, JPEG nén lưu thẳng trong Firestore, không cần Storage), `bk_roles/main` (tài khoản: owner, admins[], staff[]), `bk_users/<uid>` (tên, email, lần vào gần nhất).
- Cần thêm quy tắc bảo mật cho các bộ sưu tập `bk_*` trong Firebase Console (Firestore → Rules).
- Quản trị quản lý tài khoản, nhập danh mục và tải sao lưu ở mục **Hệ thống** (thanh bên trái) hoặc nút 👥 / ⚙ Dữ liệu trên điện thoại.
- Chạy thử với giả lập: `firebase emulators:start --only auth,firestore`, rồi mở `http://localhost:5000/bakery/?emu=1`.
