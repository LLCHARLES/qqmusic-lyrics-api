// pages/api/musixmatch.js

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  const { target_path, ...params } = req.query;
  
  // 🔍 打印所有收到的参数
  console.log('[Musixmatch Proxy] Received params:', JSON.stringify(params, null, 2));
  console.log('[Musixmatch Proxy] target_path:', target_path);
  
  if (!target_path) {
    return res.status(400).json({ error: 'Missing target_path' });
  }
  
  try {
    const musixmatchUrl = new URL(`https://apic.musixmatch.com${target_path}`);
    
    Object.keys(params).forEach(key => {
      musixmatchUrl.searchParams.append(key, params[key]);
    });
    musixmatchUrl.searchParams.append('format', 'json');
    
    // 🔍 打印最终请求的 URL（注意：不要在生产环境打印 token）
    console.log('[Musixmatch Proxy] Full URL:', musixmatchUrl.toString());
    
    const response = await fetch(musixmatchUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // 🔍 打印响应状态
    console.log('[Musixmatch Proxy] Response status:', response.status);
    
    const data = await response.json();
    return res.status(200).json(data);
    
  } catch (error) {
    console.error('[Musixmatch Proxy] Error:', error.message);
    return res.status(500).json({ 
      error: 'Proxy failed', 
      message: error.message 
    });
  }
}