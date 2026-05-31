DROP TABLE IF EXISTS admin;
DROP TABLE IF EXISTS system_settings;

CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY,        
  admin_username TEXT NOT NULL,  
  admin_password TEXT NOT NULL,  
  admin_token TEXT,              
  site_title TEXT,               
  announcement TEXT,             
  allow_download INTEGER         
);

INSERT INTO system_settings 
  (id, admin_username, admin_password, site_title, announcement, allow_download) 
VALUES 
  (1, 'admin', '123456', '夏雨资源库', '欢迎访问！请遵守下载规则。', 1);

CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  download_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
