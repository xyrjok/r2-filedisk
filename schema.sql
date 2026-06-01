CREATE TABLE system_settings ( 
  id INTEGER PRIMARY KEY, 
  admin_username TEXT NOT NULL, 
  admin_password TEXT NOT NULL, 
  admin_token TEXT, 
  site_title TEXT, 
  site_icon TEXT, 
  announcement TEXT, 
  allow_download INTEGER,
  show_index INTEGER DEFAULT 1
); 

INSERT INTO system_settings (id, admin_username, admin_password, site_title, site_icon, announcement, allow_download, show_index) 
VALUES (1, 'admin', '123456', '夏雨资源库', '/assets/xyrjico.webp', '欢迎访问！请遵守下载规则。', 1, 1);


CREATE TABLE IF NOT EXISTS categories ( 
  id INTEGER PRIMARY KEY AUTOINCREMENT, 
  name TEXT NOT NULL, 
  folder TEXT NOT NULL UNIQUE 
); 

INSERT INTO categories (name, folder) VALUES 
('软件资源', 'soft'), 
('图片资源', 'image'), 
('视频资源', 'video');


CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  download_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
