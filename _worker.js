export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 拦截所有以 /api/ 开头的请求交由 Worker 处理
    if (url.pathname.startsWith('/api/')) {
      return this.handleAPI(request, env, url);
    }

    // 2. 如果不是 API 请求，直接回源给 Pages 返回静态页面 (如 index.html, admin.html)
    return env.ASSETS.fetch(request);
  },

  // 集中处理 API 路由的函数
  async handleAPI(request, env, url) {
    // --- API 1: 获取 R2 文件列表 ---
    if (url.pathname === '/api/files' && request.method === 'GET') {
      try {
        const listed = await env.BUCKET.list();
        let files = listed.objects.map(obj => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded
        }));
        
        return new Response(JSON.stringify(files), {
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }

    // --- API 2: R2 直链下载 ---
    if (url.pathname.startsWith('/api/download/')) {
      // 提取路径并解码 (例如 /api/download/software/WinRAR.exe -> software/WinRAR.exe)
      const filePath = decodeURIComponent(url.pathname.replace('/api/download/', ''));
      
      if (!filePath) {
        return new Response('File path missing', { status: 400 });
      }

      const object = await env.BUCKET.get(filePath);

      if (object === null) {
        return new Response('File Not Found', { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      // 强制触发浏览器下载
      headers.set('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);

      return new Response(object.body, { headers });
    }

    // --- 未匹配到的 API 路由 ---
    return new Response('API Not Found', { status: 404 });
  }
};
