# Game Olympia Python + MySQL + Node Admin

Đây là bản viết lại từ dự án Java/JavaFX gốc sang Python desktop, dùng MySQL thay SQL Server và có thêm web quản trị bằng Node.js.

## Cấu trúc

- `desktop/`: app game Python dùng PySide6.
- `admin-web/`: trang web quản trị Node.js/Express/EJS.
- `db/mysql_schema.sql`: schema MySQL.
- `db/mysql_seed.sql`: dữ liệu mẫu chuyển từ `DBOlympiaGame.sql`.
- `desktop/olympia/assets/pictures/`: ảnh copy từ `src/Picture`.
- `desktop/olympia/assets/sounds/`: nơi đặt `correct.wav`, `wrong.wav`, `timeout.wav`, `click.wav` nếu muốn phát âm thanh.

## Chuẩn bị MySQL

```sql
SOURCE D:/GameOlympia/GameOlympiaPython/db/mysql_schema.sql;
SOURCE D:/GameOlympia/GameOlympiaPython/db/mysql_seed.sql;
SOURCE D:/GameOlympia/GameOlympiaPython/db/mysql_realtime_upgrade.sql;
```

Tạo file `.env` từ `.env.example` và chỉnh tài khoản MySQL:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=game_olympia
ADMIN_WEB_PORT=3000
SESSION_SECRET=change-this-secret
```

## Chạy app Python

```powershell
cd D:\GameOlympia\GameOlympiaPython
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python desktop\main.py
```

Luồng game giữ theo Java gốc: Main, Khởi Động, Vượt Chướng Ngại Vật, Tăng Tốc, Về Đích, lưu điểm cao.

## Chạy web quản trị Node.js

```powershell
cd D:\GameOlympia\GameOlympiaPython\admin-web
npm.cmd install
npm.cmd start
```

Mở `http://localhost:3000`. Tài khoản mặc định: `admin/admin`.

Web admin quản lý:

- Bộ đề thi.
- Câu hỏi Khởi Động, VCNV, Tăng Tốc, Về Đích.
- Điểm cao.
- Phòng thi/server, thí sinh, media/âm thanh/hình ảnh theo yêu cầu trong file đính kèm.
- Technician Panel realtime tại `http://localhost:3000/technician`.
- Link thí sinh default/Olympia UI, projector, OBS overlay, host/MC và scoreboard.
- Import/export JSON/Excel, mẫu Q2T Standard và LCT3.
- Chấm Tăng tốc theo thời gian gửi đúng, reset round, delay chuông, ngôi sao hy vọng, Only Connect.

Khi chạy `npm.cmd start`, web admin sẽ tự chạy `db/mysql_realtime_upgrade.sql` và thêm các cột còn thiếu nếu user MySQL có quyền `CREATE`/`ALTER`.

## O26 rules update

- Admin Panel co `Rule preset` voi `Olympia 26 (Moi nhat)` va `Olympia 24 / Custom`.
- Olympia 26 ap dung: Khoi dong ca nhan 6 cau x 5s, Khoi dong chung 12 cau voi phat sai/khong tra loi sau chuong -5, VCNV 15s hang ngang/+10 va CNV trung tam +20, Tang toc 20/20/30/30, Ve dich chi goi 20/40, Cau hoi phu 15s sudden death.
- Ve dich: thi sinh chinh duoc gui lai dap an va chi cham ban cuoi; luot cuop diem chi nhan dap an dau tien. Ngoi sao hy vong bi khoa truoc khi hien cau hoi.
- `mysql_realtime_upgrade.sql` tao bo cau 40 diem tu cau 30 diem cu neu database chua co du lieu 40 diem.

## Ghi chú

Dự án Java gốc không có file âm thanh trong source, nên bản Python chỉ dựng sẵn lớp phát âm thanh và thư mục `assets/sounds`. Khi thêm file `.wav` đúng tên, app sẽ tự phát ở các sự kiện đúng/sai/hết giờ.
