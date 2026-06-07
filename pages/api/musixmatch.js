// pages/api/musixmatch.js

export default async function handler(req, res) {
  // CORS 设置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // 获取客户端传来的参数
  const { target_path, ...params } = req.query;
  
  if (!target_path) {
    return res.status(400).json({ 
      error: 'Missing parameter', 
      message: 'target_path is required' 
    });
  }
  
  // Musixmatch API 地址
  const MUSIXMATCH_API = 'https://apic.musixmatch.com';
  
  // 构建请求 URL
  const url = `${MUSIXMATCH_API}${target_path}`;
  
  // 构建查询参数 - 直接把 iOS 传来的所有参数转发
  const queryParams = new URLSearchParams();
  
  Object.keys(params).forEach(key => {
    if (params[key]) {
      queryParams.append(key, params[key]);
    }
  });
  
  // 强制 JSON 格式
  queryParams.set('format', 'json');
  
  const fullUrl = `${url}?${queryParams.toString()}`;
  
  console.log('[Musixmatch Proxy] Requesting:', target_path);
  
  try {
    // 发起请求到 Musixmatch（Vercel 海外节点自动绕过防火墙）
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Vercel-Musixmatch-Proxy/1.0',
        'Accept': 'application/json'
      }
    });
    
    // 获取响应数据
    const data = await response.json();
    
    // 返回给客户端
    res.status(response.status).json(data);
    
  } catch (error) {
    console.error('[Musixmatch Proxy] Error:', error.message);
    res.status(500).json({ 
      error: 'Proxy request failed', 
      message: error.message 
    });
  }
}