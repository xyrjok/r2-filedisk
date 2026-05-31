export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return this.handleAPI(request, env, ctx, url);
    }
    return env.ASSETS.fetch(request);
  },

  async handleAPI(request, env, ctx, url) {
    // --- 开放 API: 获取系统配置 (前端读取标题、公告等) ---
    if (url.pathname === '/api/settings' && request.method === 'GET') {
      const settings = await env.db.prepare("SELECT site_title, announcement, allow_download FROM system_settings WHERE id = 1").first();
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
      // 1. 拦截器：检查系统配置是否允许下载
      const settings = await env.db.prepare("SELECT allow_download FROM system_settings WHERE id = 1").first();
      if (settings && settings.allow_download === 0) {
         return new Response('站点维护中，已暂停下载服务', { status: 403 });
      }

      const filePath = decodeURIComponent(url.pathname.replace('/api/download/', ''));
      if (!filePath) return new Response('File path missing', { status: 400 });

      const object = await env.r2.get(filePath);
      if (object === null) return new Response('File Not Found', { status: 404 });

      // 2. 异步记录下载日志
      ctx.waitUntil(
        env.db.prepare("INSERT INTO download_logs (file_path) VALUES (?)").bind(filePath).run()
      );

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);
      return new Response(object.body, { headers });
    }

    // --- 后台 API: 登录 ---
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

    // ==========================================
    // --- 需要鉴权的后台 API (Token 校验) ---
    // ==========================================
    if (url.pathname.startsWith('/api/admin/')) {
      const authHeader = request.headers.get('Authorization');
      const token = authHeader ? authHeader.replace('Bearer ', '') : null;
      if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

      const user = await env.db.prepare("SELECT * FROM system_settings WHERE admin_token = ? AND id = 1").bind(token).first();
      if (!user) return new Response(JSON.stringify({ error: 'Invalid Token' }), { status: 401 });

      // 统计数据
      if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
        const list = await env.r2.list();
        const dbRes = await env.db.prepare("SELECT COUNT(*) as count FROM download_logs").first();
        return new Response(JSON.stringify({ fileCount: list.objects.length, downloadCount: dbRes.count }));
      }

      // 获取当前设置
      if (url.pathname === '/api/admin/settings' && request.method === 'GET') {
        const set = await env.db.prepare("SELECT admin_username, site_title, announcement, allow_download FROM system_settings WHERE id = 1").first();
        return new Response(JSON.stringify(set));
      }

      // 更新当前设置
      if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
        const { site_title, announcement, allow_download, admin_username, admin_password } = await request.json();
        let query = "UPDATE system_settings SET site_title = ?, announcement = ?, allow_download = ?";
        let params = [site_title, announcement, allow_download];
        // 如果提交了账号密码，也一并更新
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
