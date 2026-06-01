export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return this.handleAPI(request, env, ctx, url);
    }
    return env.ASSETS.fetch(request);
  },

  async handleAPI(request, env, ctx, url) {
    // --- 开放 API: 获取系统配置 (包含图标) ---
    if (url.pathname === '/api/settings' && request.method === 'GET') {
      const settings = await env.db.prepare("SELECT site_title, site_icon, announcement, allow_download, show_index FROM system_settings WHERE id = 1").first();
      return new Response(JSON.stringify(settings || {}), { headers: { 'Content-Type': 'application/json' } });
    }

    // --- 开放 API: 获取 R2 文件列表 ---
    if (url.pathname === '/api/files' && request.method === 'GET') {
      try {
        const listed = await env.r2.list();
        let files = listed.objects.map(obj => ({ key: obj.key, size: obj.size, uploaded: obj.uploaded }));
        return new Response(JSON.stringify(files), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // --- 开放 API: R2 直链下载 ---
    if (url.pathname.startsWith('/api/download/')) {
      const settings = await env.db.prepare("SELECT allow_download FROM system_settings WHERE id = 1").first();
      if (settings && settings.allow_download === 0) {
         return new Response('站点维护中，已暂停下载服务', { status: 403 });
      }

      const filePath = decodeURIComponent(url.pathname.replace('/api/download/', ''));
      if (!filePath) return new Response('File path missing', { status: 400 });

      const object = await env.r2.get(filePath);
      if (object === null) return new Response('File Not Found', { status: 404 });

      ctx.waitUntil(
        env.db.prepare("INSERT INTO download_logs (file_path) VALUES (?)").bind(filePath).run()
      );

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);
      return new Response(object.body, { headers });
    }

    // --- 后台 API: 密码登录 ---
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      const { username, password } = await request.json();
      const user = await env.db.prepare("SELECT * FROM system_settings WHERE admin_username = ? AND admin_password = ? AND id = 1")
                             .bind(username, password).first();
      if (user) {
        const token = crypto.randomUUID();
        await env.db.prepare("UPDATE system_settings SET admin_token = ? WHERE id = 1").bind(token).run();
        return new Response(JSON.stringify({ success: true, token }), { headers: { 'Content-Type': 'application/json' } });
      } else {
        return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401 });
      }
    }

    // --- 后台 API: TG 快捷登录 ---
    if (url.pathname === '/api/admin/tg_login' && request.method === 'POST') {
      const tgData = await request.json();
      const botToken = env.TG_BOT_TOKEN; 
      if (!botToken) return new Response(JSON.stringify({ success: false, error: '后端未配置 TG_BOT_TOKEN' }), { status: 500 });
      
      // HMAC-SHA256 校验 TG 数据真伪 (官方安全规范)
      const { hash, ...dataCheck } = tgData;
      const dataCheckString = Object.keys(dataCheck).sort().map(k => `${k}=${dataCheck[k]}`).join('\n');
      const encoder = new TextEncoder();
      
      try {
        const secretKey = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(botToken)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const signature = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(dataCheckString));
        const hexSignature = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
        
        if (hexSignature !== hash) return new Response(JSON.stringify({ success: false, error: 'TG 授权数据被篡改' }), { status: 403 });

        const authUser = await env.db.prepare("SELECT * FROM tg_admins WHERE tg_id = ?").bind(tgData.id.toString()).first();
        if (authUser) {
          const token = crypto.randomUUID();
          await env.db.prepare("UPDATE system_settings SET admin_token = ? WHERE id = 1").bind(token).run();
          return new Response(JSON.stringify({ success: true, token }), { headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({ success: false, error: '当前 TG 账号未在后台授权' }), { status: 403 });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: '验证处理异常' }), { status: 500 });
      }
    }

    // ==========================================
    // --- 需要鉴权的后台 API (Token 校验) ---
    // ==========================================
    if (url.pathname.startsWith('/api/admin/')) {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader ? authHeader.replace('Bearer ', '') : null;
      if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

      const user = await env.db.prepare("SELECT * FROM system_settings WHERE admin_token = ? AND id = 1").bind(token).first();
      if (!user) return new Response(JSON.stringify({ error: 'Invalid Token' }), { status: 401 });

      // 获取统计数据及图表数据
      if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
        const list = await env.r2.list();
        const dbRes = await env.db.prepare("SELECT COUNT(*) as count FROM download_logs").first();
        // 累加 R2 对象列表中所有文件的 size 计算总容量
        const totalSize = list.objects.reduce((sum, obj) => sum + obj.size, 0);
        // 获取近7天下载趋势
        const chartRes = await env.db.prepare(`
          SELECT date(download_time) as d_date, COUNT(*) as d_count 
          FROM download_logs 
          WHERE download_time >= date('now', '-7 days') 
          GROUP BY date(download_time) ORDER BY d_date ASC
        `).all();
        return new Response(JSON.stringify({ 
            fileCount: list.objects.length, 
            totalSize: totalSize,
            downloadCount: dbRes.count,
            trend: chartRes.results
        }));
      }

      // 获取后台专属文件列表(含独立下载量)
      if (url.pathname === '/api/admin/files' && request.method === 'GET') {
        const listed = await env.r2.list();
        const dlsRes = await env.db.prepare("SELECT file_path, COUNT(*) as d_count FROM download_logs GROUP BY file_path").all();
        const dlsMap = {};
        dlsRes.results.forEach(r => dlsMap[r.file_path] = r.d_count);

        let files = listed.objects.map(obj => ({ 
            key: obj.key, 
            size: obj.size, 
            uploaded: obj.uploaded,
            downloads: dlsMap[obj.key] || 0
        }));
        return new Response(JSON.stringify(files));
      }

      // 分类管理 CRUD
      if (url.pathname === '/api/admin/categories' && request.method === 'GET') {
        const res = await env.db.prepare("SELECT * FROM categories ORDER BY id DESC").all();
        return new Response(JSON.stringify(res.results));
      }
      if (url.pathname === '/api/admin/categories' && request.method === 'POST') {
        const { name, folder } = await request.json();
        await env.db.prepare("INSERT INTO categories (name, folder) VALUES (?, ?)").bind(name, folder).run();
        return new Response(JSON.stringify({ success: true }));
      }
      if (url.pathname === '/api/admin/categories' && request.method === 'DELETE') {
        const { id } = await request.json();
        await env.db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }));
      }
      
      // TG 管理员 CRUD
      if (url.pathname === '/api/admin/tg_users' && request.method === 'GET') {
        const res = await env.db.prepare("SELECT * FROM tg_admins ORDER BY id DESC").all();
        return new Response(JSON.stringify(res.results));
      }
      if (url.pathname === '/api/admin/tg_users' && request.method === 'POST') {
        const { tg_id, note } = await request.json();
        await env.db.prepare("INSERT INTO tg_admins (tg_id, note) VALUES (?, ?)").bind(tg_id, note).run();
        return new Response(JSON.stringify({ success: true }));
      }
      if (url.pathname === '/api/admin/tg_users' && request.method === 'DELETE') {
        const { id } = await request.json();
        await env.db.prepare("DELETE FROM tg_admins WHERE id = ?").bind(id).run();
        return new Response(JSON.stringify({ success: true }));
      }

      // 获取当前设置 (含图标)
      if (url.pathname === '/api/admin/settings' && request.method === 'GET') {
        const set = await env.db.prepare("SELECT admin_username, site_title, site_icon, announcement, allow_download, show_index FROM system_settings WHERE id = 1").first();
        return new Response(JSON.stringify(set));
      }

      // 更新当前设置 (含图标)
      if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
        const { site_title, site_icon, announcement, allow_download, show_index, admin_username, admin_password } = await request.json();
        let query = "UPDATE system_settings SET site_title = ?, site_icon = ?, announcement = ?, allow_download = ?, show_index = ?";
        let params = [site_title, site_icon, announcement, allow_download, show_index];
        if (admin_username && admin_password) {
           query += ", admin_username = ?, admin_password = ?";
           params.push(admin_username, admin_password);
        }
        query += " WHERE id = 1";
        
        await env.db.prepare(query).bind(...params).run();
        return new Response(JSON.stringify({ success: true }));
      }

      // R2 删除与上传
      if (url.pathname === '/api/admin/delete' && request.method === 'POST') {
        const { key } = await request.json();
        await env.r2.delete(key);
        return new Response(JSON.stringify({ success: true }));
      }
      if (url.pathname === '/api/admin/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        let path = formData.get('path') || '';
        if (path && !path.endsWith('/')) path += '/';
        await env.r2.put(path + file.name, file.stream(), { httpMetadata: { contentType: file.type } });
        return new Response(JSON.stringify({ success: true }));
      }
    }
    return new Response('API Not Found', { status: 404 });
  }
};
