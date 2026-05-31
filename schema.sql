DROP TABLE IF EXISTS admin;
CREATE TABLE admin (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL
);

-- 默认账号 admin, 密码 123456 (实际部署请修改)
INSERT INTO admin (username, password) VALUES ('admin', '123456');

CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  download_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
