import axios from 'axios';
import crypto from 'crypto';
import pako from 'pako';

// QQ音乐DES解密密钥
const QQ_KEY = '!@#)(*$%123ZXC!@!@#)(NHL';

// 歌曲映射表
const songMapping = {
  '無條件_陳奕迅': '001HpGqo4daJ21',
  '一樣的月光_徐佳瑩': '001KyJTt1kbkfP',
  '拉过勾的_陸虎': '004QCuMF2nVaxn',
  '人生馬拉松_陳奕迅': '004J2NXe3bwkjk',
  '天空之城_李志': '002QU4XI2cKwua',
  '關於鄭州的記憶_李志': '002KPXam27DeEJ',
  '大碗宽面_吳亦凡': '001JceuO3lQbyN',
  'November Rain_吳亦凡': '000RQ1Hy29awJd',
  'July_吳亦凡': '001fszA13qSD04',
  'La La La_Naughty Boy': '0000TrG33CVLrW',
  // 测试歌曲
  '我懷念的_孙燕姿': '0025NhlN2yWrP4',
  '晴天_周杰伦': '004GZytN2yWrP4',
};

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
  
  const { track_name, artist_name, trackName, artistName } = req.query;
  const finalTrackName = trackName || track_name;
  const finalArtistName = artistName || artist_name;
  
  if (!finalTrackName || !finalArtistName) {
    return res.status(400).json({ 
      error: 'Missing parameters',
      message: 'trackName/track_name 和 artistName/artist_name 参数都是必需的'
    });
  }
  
  try {
    console.log('搜索请求:', { trackName: finalTrackName, artistName: finalArtistName });
    
    // 预处理
    const processedTrackName = preprocessTrackName(finalTrackName);
    const processedArtists = preprocessArtists(finalArtistName);
    
    // 检查是否需要直接映射到特定MID
    const mappedMid = checkSongMapping(processedTrackName, processedArtists, finalTrackName, finalArtistName);
    if (mappedMid) {
      console.log(`检测到映射歌曲，直接使用MID: ${mappedMid}`);
      return await handleMappedSong(mappedMid, finalTrackName, finalArtistName, res);
    }
    
    console.log('正常搜索:', processedTrackName);
    
    // 使用官方API搜索
    const song = await searchSongOfficial(processedTrackName, processedArtists, finalTrackName, finalArtistName);
    
    if (!song) {
      return res.status(404).json({ error: 'Song not found', message: '未找到匹配的歌曲' });
    }
    
    console.log('找到歌曲:', { 
      name: song.name || song.songname || song.title, 
      artist: extractArtistsOfficial(song), 
      id: song.id || song.songid,
      mid: song.mid || song.songmid
    });
    
    // 获取歌曲ID（用于QRC歌词）
    const songId = song.id || song.songid;
    const songMid = song.mid || song.songmid;
    
    if (!songId) {
      console.log('警告：未找到歌曲ID');
    }
    
    // 获取歌词
    const lyrics = await getLyricsOfficial(songMid, songId);
    
    // 返回结果
    const response = {
      id: song.id || song.songid,
      mid: song.mid || song.songmid,
      name: song.name || song.songname || song.title || finalTrackName,
      trackName: song.name || song.songname || song.title || finalTrackName,
      artistName: extractArtistsOfficial(song),
      albumName: extractAlbumNameOfficial(song),
      duration: calculateDuration(song.interval || song.duration),
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '',
      syncedLyrics: lyrics.syncedLyrics,
      translatedLyrics: lyrics.translatedLyrics,
      yrcLyrics: lyrics.yrcLyrics
    };
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// 检查歌曲映射
function checkSongMapping(processedTrackName, processedArtists, originalTrackName, originalArtistName) {
  const possibleKeys = [
    `${processedTrackName}_${processedArtists[0]}`,
    `${originalTrackName}_${originalArtistName}`,
    `${processedTrackName}_${originalArtistName}`,
    `${originalTrackName}_${processedArtists[0]}`,
    `${processedTrackName.toLowerCase()}_${processedArtists[0]}`,
    `${originalTrackName.toLowerCase()}_${originalArtistName}`,
    `${processedTrackName.toLowerCase()}_${originalArtistName}`,
    `${originalTrackName.toLowerCase()}_${processedArtists[0]}`
  ];
  
  for (const key of possibleKeys) {
    if (songMapping[key]) {
      return songMapping[key];
    }
  }
  
  return null;
}

// 处理映射歌曲
async function handleMappedSong(mappedMid, originalTrackName, originalArtistName, res) {
  try {
    // 获取歌曲信息
    let songInfo = null;
    try {
      songInfo = await getSongInfoOfficial(mappedMid);
    } catch (error) {
      console.log('无法获取歌曲信息，使用默认信息');
    }
    
    // 获取歌词 - 尝试多种方法
    const lyrics = await getLyricsWithFallback(mappedMid, mappedMid);
    
    const response = {
      id: mappedMid,
      mid: mappedMid,
      name: songInfo ? (songInfo.name || songInfo.title || songInfo.songname) : originalTrackName,
      trackName: songInfo ? (songInfo.name || songInfo.title || songInfo.songname) : originalTrackName,
      artistName: songInfo ? extractArtistsOfficial(songInfo) : originalArtistName,
      albumName: songInfo ? extractAlbumNameOfficial(songInfo) : '',
      duration: songInfo ? calculateDuration(songInfo.interval || songInfo.duration) : 0,
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '',
      syncedLyrics: lyrics.syncedLyrics,
      translatedLyrics: lyrics.translatedLyrics,
      yrcLyrics: lyrics.yrcLyrics,
      isMapped: true,
      originalTrackName: originalTrackName,
      originalArtistName: originalArtistName
    };
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('处理映射歌曲失败:', error);
    res.status(500).json({ error: 'Failed to get mapped song', message: error.message });
  }
}

// 使用官方API搜索歌曲
async function searchSongOfficial(trackName, artists, originalTrackName, originalArtistName) {
  const strategies = [
    () => {
      const coreName = extractCoreName(trackName);
      return artists.map(artist => `${coreName} ${artist}`);
    },
    () => {
      const processed = preprocessTrackName(trackName);
      return artists.map(artist => `${processed} ${artist}`);
    },
    () => {
      const coreName = extractCoreName(trackName);
      return [coreName];
    }
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    try {
      const keywords = strategies[i]();
      
      for (const keyword of keywords) {
        const result = await searchOfficialAPI(keyword);
        
        if (result && result.length > 0) {
          const match = findBestMatchOfficial(result, trackName, artists, originalTrackName, originalArtistName);
          if (match) {
            return match;
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.warn(`策略${i+1} 失败:`, error.message);
    }
  }
  
  return null;
}

// 使用官方API搜索
async function searchOfficialAPI(keyword) {
  try {
    const searchUrl = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
    const params = {
      w: encodeURIComponent(keyword),
      p: 1,
      n: 10,
      format: 'json',
      outCharset: 'utf-8',
      t: 0
    };
    
    const response = await axios.get(searchUrl, {
      params,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // 处理可能包含回调函数的数据
    let data = response.data;
    if (typeof data === 'string') {
      // 尝试提取JSON
      const match = data.match(/{.*}/);
      if (match) {
        try {
          data = JSON.parse(match[0]);
        } catch (e) {
          // 如果失败，尝试其他方法
        }
      }
    }
    
    if (data && data.data && data.data.song && data.data.song.list) {
      return data.data.song.list;
    }
    
    return [];
  } catch (error) {
    console.error('官方搜索失败:', error.message);
    return [];
  }
}

// 获取歌曲信息
async function getSongInfoOfficial(mid) {
  try {
    const response = await axios.get('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg', {
      params: {
        songmid: mid,
        format: 'json'
      },
      headers: {
        'Referer': 'https://y.qq.com/'
      }
    });
    
    let data = response.data;
    if (typeof data === 'string') {
      // 尝试提取JSON
      const match = data.match(/{.*}/);
      if (match) {
        try {
          data = JSON.parse(match[0]);
        } catch (e) {
          throw new Error('解析失败');
        }
      }
    }
    
    if (data && data.data && data.data.length > 0) {
      return data.data[0];
    }
    
    throw new Error('未找到歌曲信息');
  } catch (error) {
    throw error;
  }
}

// 获取歌词（带备用方案）
async function getLyricsWithFallback(songMid, songId) {
  try {
    console.log('尝试获取歌词，MID:', songMid, 'ID:', songId);
    
    // 首先尝试第三方API获取逐字歌词
    const thirdPartyYrc = await getYrcFromThirdParty(songMid);
    if (thirdPartyYrc) {
      console.log('从第三方API获取到逐字歌词');
      const standardLyrics = await getStandardLyrics(songMid);
      return {
        syncedLyrics: standardLyrics.lyric || '',
        plainLyrics: '',
        translatedLyrics: standardLyrics.trans || '',
        yrcLyrics: thirdPartyYrc
      };
    }
    
    // 如果第三方失败，尝试官方QRC
    const lyrics = await getLyricsOfficial(songMid, songId);
    if (lyrics.yrcLyrics) {
      console.log('从官方API获取到逐字歌词');
      return lyrics;
    }
    
    // 如果都没有，返回空
    console.log('未获取到逐字歌词');
    return lyrics;
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 从第三方API获取逐字歌词
async function getYrcFromThirdParty(songMid) {
  try {
    const response = await axios.get(`https://api.vkeys.cn/v2/music/tencent/lyric?mid=${songMid}`, {
      timeout: 5000
    });
    
    if (response.data && response.data.code === 200 && response.data.data && response.data.data.yrc) {
      const yrcContent = response.data.data.yrc;
      // 简单过滤
      return filterYrcLyrics(yrcContent);
    }
    
    return null;
  } catch (error) {
    console.log('第三方API获取失败:', error.message);
    return null;
  }
}

// 获取歌词官方API
async function getLyricsOfficial(songMid, songId) {
  try {
    // 获取标准歌词
    const standardLyrics = await getStandardLyrics(songMid);
    
    // 尝试获取QRC歌词
    let yrcLyrics = '';
    if (songId) {
      yrcLyrics = await getQrcLyrics(songId);
    }
    
    return {
      syncedLyrics: standardLyrics.lyric || '',
      plainLyrics: '',
      translatedLyrics: standardLyrics.trans || '',
      yrcLyrics: yrcLyrics
    };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 获取标准歌词
async function getStandardLyrics(songMid) {
  try {
    const callback = 'MusicJsonCallback_lrc';
    const currentMillis = Date.now();
    
    const response = await axios.get('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
      params: {
        callback: callback,
        pcachetime: currentMillis,
        songmid: songMid,
        g_tk: 5381,
        jsonpCallback: callback,
        loginUin: 0,
        hostUin: 0,
        format: 'jsonp',
        inCharset: 'utf8',
        outCharset: 'utf8',
        notice: 0,
        platform: 'yqq',
        needNewCode: 0
      },
      headers: {
        'Referer': 'https://y.qq.com/'
      }
    });
    
    let data = response.data;
    if (typeof data === 'string' && data.startsWith(callback)) {
      data = data.replace(callback + '(', '').slice(0, -1);
      try {
        data = JSON.parse(data);
      } catch (e) {
        throw new Error('解析歌词失败');
      }
    }
    
    const result = {
      lyric: '',
      trans: ''
    };
    
    if (data && data.code === 0) {
      if (data.lyric) {
        try {
          result.lyric = Buffer.from(data.lyric, 'base64').toString('utf-8');
          // 过滤标准歌词
          result.lyric = filterLyrics(result.lyric, 'lrc');
        } catch (e) {
          console.error('解码歌词失败:', e);
        }
      }
      
      if (data.trans) {
        try {
          result.trans = Buffer.from(data.trans, 'base64').toString('utf-8');
          // 过滤翻译歌词
          result.trans = filterLyrics(result.trans, 'lrc');
        } catch (e) {
          console.error('解码翻译失败:', e);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('获取标准歌词失败:', error.message);
    return { lyric: '', trans: '' };
  }
}

// 获取QRC歌词
async function getQrcLyrics(songId) {
  try {
    console.log('尝试获取QRC歌词，歌曲ID:', songId);
    
    const response = await axios.get('https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg', {
      params: {
        version: '15',
        miniversion: '82',
        lrctype: '4',
        musicid: songId
      },
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const xmlData = response.data;
    console.log('获取到QRC响应，长度:', xmlData.length);
    
    // 预处理XML
    const processedXml = preprocessXml(xmlData);
    
    // 提取加密文本
    const encryptedText = extractEncryptedText(processedXml);
    
    if (!encryptedText) {
      console.log('未找到加密文本');
      return '';
    }
    
    console.log('找到加密文本，长度:', encryptedText.length);
    
    // 解密
    const decrypted = decryptLyrics(encryptedText);
    
    if (!decrypted) {
      console.log('解密失败');
      return '';
    }
    
    console.log('解密成功，长度:', decrypted.length);
    
    // 处理解密后的内容
    const processed = processDecryptedLyrics(decrypted);
    
    if (processed) {
      console.log('处理成功，提取到逐字歌词');
      return filterYrcLyrics(processed);
    }
    
    return '';
    
  } catch (error) {
    console.error('获取QRC歌词失败:', error.message);
    return '';
  }
}

// XML预处理
function preprocessXml(xml) {
  if (!xml) return '';
  
  // 1. 移除注释
  let processed = xml.replace(/<!--/g, '').replace(/-->/g, '');
  
  // 2. 修复常见的XML格式问题
  // 修复未转义的&符号
  processed = processed.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;');
  
  // 3. 修复属性值中的引号问题
  processed = processed.replace(/(\w+)="([^"]*)"/g, (match, attr, value) => {
    return `${attr}="${value.replace(/"/g, '&quot;')}"`;
  });
  
  // 4. 移除格式错误的标签
  const lines = processed.split('\n');
  const validLines = lines.filter(line => {
    const trimmed = line.trim();
    // 跳过明显格式错误的行
    if (trimmed.includes('=') && !trimmed.includes('"') && trimmed.includes('>')) {
      return false;
    }
    return true;
  });
  
  return validLines.join('\n');
}

// 提取加密文本
function extractEncryptedText(xml) {
  if (!xml) return null;
  
  // 尝试匹配多种可能的格式
  const patterns = [
    // 匹配 <Lyric_1>加密文本</Lyric_1>
    /<Lyric_1[^>]*>([0-9a-fA-F]+)<\/Lyric_1>/,
    // 匹配 LyricContent="加密文本"
    /LyricContent="([0-9a-fA-F]+)"/,
    // 匹配 <content>加密文本</content>
    /<content>([0-9a-fA-F]+)<\/content>/,
    // 匹配任意十六进制字符串（较长的）
    />([0-9a-fA-F]{100,})</,
  ];
  
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match && match[1]) {
      const text = match[1].trim();
      // 验证是否为有效的十六进制字符串
      if (/^[0-9a-fA-F]+$/.test(text) && text.length >= 32) {
        console.log(`使用模式匹配到加密文本，长度: ${text.length}`);
        return text;
      }
    }
  }
  
  return null;
}

// DES解密
function decryptLyrics(encryptedHex) {
  try {
    // 将十六进制转换为Buffer
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    
    // 使用3DES ECB模式解密
    const key = Buffer.from(QQ_KEY, 'binary');
    
    // 创建解密器
    const decipher = crypto.createDecipheriv('des-ede3', key, Buffer.alloc(0));
    decipher.setAutoPadding(true);
    
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // 尝试解压缩
    try {
      const decompressed = pako.inflate(decrypted);
      decrypted = Buffer.from(decompressed);
    } catch (e) {
      // 可能不是压缩数据，继续使用原始数据
      console.log('解压缩失败，使用原始数据');
    }
    
    // 移除BOM
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    if (decrypted.slice(0, 3).equals(bom)) {
      decrypted = decrypted.slice(3);
    }
    
    // 转换为字符串
    return decrypted.toString('utf-8');
    
  } catch (error) {
    console.error('解密失败:', error.message);
    return null;
  }
}

// 处理解密后的歌词
function processDecryptedLyrics(decryptedText) {
  if (!decryptedText) return '';
  
  console.log('解密后内容前100字符:', decryptedText.substring(0, 100));
  
  // 检查是否为XML格式
  if (decryptedText.includes('<?xml') || decryptedText.includes('<Lyric_')) {
    try {
      // 尝试提取LyricContent属性
      const match = decryptedText.match(/LyricContent="([^"]*)"/);
      if (match && match[1]) {
        return match[1];
      }
      
      // 尝试提取标签内容
      const tagMatch = decryptedText.match(/<Lyric_1[^>]*>([\s\S]*?)<\/Lyric_1>/);
      if (tagMatch && tagMatch[1]) {
        return tagMatch[1];
      }
    } catch (err) {
      console.warn('解析XML歌词失败:', err.message);
    }
  }
  
  // 如果不是XML，直接返回
  return decryptedText;
}

// 过滤YRC歌词
function filterYrcLyrics(yrcContent) {
  if (!yrcContent || yrcContent.trim() === '') return '';
  
  const lines = yrcContent.split('\n');
  const filteredLines = [];
  let foundLyricsStart = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') continue;
    
    // 跳过明显的元数据行
    if (trimmed.startsWith('[') && trimmed.includes('ti:') || 
        trimmed.startsWith('[') && trimmed.includes('ar:') ||
        trimmed.startsWith('[') && trimmed.includes('al:')) {
      continue;
    }
    
    // 跳过制作信息
    if (isProductionLine(trimmed)) {
      continue;
    }
    
    // 跳过版权信息
    if (isLicenseWarningLine(trimmed)) {
      continue;
    }
    
    // 一旦找到真正的歌词行，标记开始
    if (!foundLyricsStart && trimmed.startsWith('[') && trimmed.includes(',')) {
      foundLyricsStart = true;
    }
    
    if (foundLyricsStart) {
      filteredLines.push(line);
    }
  }
  
  return filteredLines.join('\n');
}

// 过滤歌词
function filterLyrics(lyricContent, type = 'lrc') {
  if (!lyricContent || lyricContent.trim() === '') return '';
  
  const lines = lyricContent.split('\n');
  const filteredLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') continue;
    
    // 跳过元数据行
    if (/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed)) {
      continue;
    }
    
    // 跳过制作信息
    if (isProductionLine(trimmed)) {
      continue;
    }
    
    // 跳过版权信息
    if (isLicenseWarningLine(trimmed)) {
      continue;
    }
    
    filteredLines.push(line);
  }
  
  return filteredLines.join('\n');
}

// 查找最佳匹配
function findBestMatchOfficial(results, targetTrack, artists, originalTrackName, originalArtistName) {
  const exactMatch = findExactMatchOfficial(results, originalTrackName, originalArtistName);
  if (exactMatch) return exactMatch;
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    const score = calculateSmartScoreOfficial(song, targetTrack, artists, originalTrackName, originalArtistName);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  return bestMatch || (results.length > 0 ? results[0] : null);
}

function findExactMatchOfficial(results, originalTrackName, originalArtistName) {
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  for (const song of results) {
    const songName = getSongNameOfficial(song);
    const songArtists = extractArtistsOfficial(song);
    
    if (songName && songArtists) {
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
        return song;
      }
    }
  }
  
  return null;
}

function calculateSmartScoreOfficial(song, targetTrack, artists, originalTrackName, originalArtistName) {
  const songName = getSongNameOfficial(song);
  if (!songName) return 0;
  
  const songTitle = songName.toLowerCase();
  const songArtists = extractArtistsOfficial(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  const originalTrackNameLower = originalTrackName.toLowerCase();
  const originalArtistNameLower = originalArtistName.toLowerCase();
  
  let titleScore = 0;
  let artistScore = 0;
  
  if (songTitle === originalTrackNameLower) {
    titleScore = 100;
  } else if (songTitle === targetTrackLower) {
    titleScore = 90;
  } else if (isCloseMatch(songTitle, originalTrackNameLower)) {
    titleScore = 80;
  } else if (isCloseMatch(songTitle, targetTrackLower)) {
    titleScore = 70;
  }
  
  const songArtistsArray = songArtists.split(/\s*,\s*|\s+&\s+/);
  
  for (const targetArtist of artists) {
    const targetArtistLower = targetArtist.toLowerCase();
    
    for (const songArtist of songArtistsArray) {
      if (songArtist === originalArtistNameLower) {
        artistScore = Math.max(artistScore, 100);
        break;
      } else if (songArtist === targetArtistLower) {
        artistScore = Math.max(artistScore, 80);
        break;
      } else if (songArtist.includes(originalArtistNameLower) || originalArtistNameLower.includes(songArtist)) {
        artistScore = Math.max(artistScore, 60);
        break;
      } else if (songArtist.includes(targetArtistLower) || targetArtistLower.includes(songArtist)) {
        artistScore = Math.max(artistScore, 40);
        break;
      }
    }
  }
  
  let titleWeight = 0.6;
  let artistWeight = 0.4;
  
  if (artistScore >= 80 && titleScore >= 40) {
    titleWeight = 0.4;
    artistWeight = 0.6;
  }
  
  if (titleScore >= 90 && artistScore >= 40) {
    titleWeight = 0.8;
    artistWeight = 0.2;
  }
  
  let totalScore = (titleScore * titleWeight) + (artistScore * artistWeight);
  
  if (songTitle === originalTrackNameLower) {
    totalScore = Math.max(totalScore, 95);
  }
  
  if (titleScore >= 70 && artistScore >= 80) {
    totalScore += 15;
  }
  
  if (artistScore === 100 && titleScore >= 40) {
    totalScore += 10;
  }
  
  return totalScore;
}

function getSongNameOfficial(song) {
  return song.songname || song.name || song.title || song.songName;
}

function extractArtistsOfficial(song) {
  if (!song.singer) return '';
  
  if (Array.isArray(song.singer)) {
    return song.singer.map(s => {
      if (typeof s === 'object') return s.name || s.title || s.singer_name || '';
      return String(s);
    }).filter(Boolean).join(', ');
  } else if (typeof song.singer === 'object') {
    return song.singer.name || song.singer.title || song.singer.singer_name || '';
  } else {
    return String(song.singer);
  }
}

function extractAlbumNameOfficial(song) {
  if (!song.albumname) return '';
  return song.albumname;
}

function preprocessArtists(artistName) {
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  return [...new Set(artists.filter(artist => artist.trim()))];
}

function preprocessTrackName(trackName) {
  const patterns = [
    / - genshin impact's.*$/i,
    / - .*anniversary.*$/i,
    / - .*theme song.*$/i,
    / - .*japanese.*$/i,
    / - .*version.*$/i,
    / - 《.*?》.*$/,
    / - .*动画.*$/,
    / - .*剧集.*$/,
    / - .*主题曲.*$/,
    /\(.*?\)/g,
    / - from the.*$/i,
    / - official.*$/i,
    / \(from.*\)/gi,
    / - remastered.*$/i,
    / - .*mix.*$/i,
    / - .*edit.*$/i,
    /《(.*?)》/g,
    /---/g,
    /———/g,
    / - $/,
  ];
  
  let processed = trackName;
  for (const pattern of patterns) {
    processed = processed.replace(pattern, '');
  }
  
  processed = processed.replace(/\s+/g, ' ').replace(/[-\s]+$/g, '').trim();
  return processed || trackName.split(/[-\s–—]/)[0].trim();
}

function extractCoreName(text) {
  const isEnglish = /^[a-zA-Z\s.,!?'"-]+$/.test(text);
  if (isEnglish) {
    const processed = preprocessTrackName(text);
    return processed && processed.length < text.length ? processed : text;
  }
  
  const japanesePart = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  if (japanesePart) return japanesePart[0];
  
  const processed = preprocessTrackName(text);
  return processed && processed.length < text.length ? processed : text.split(/[-\s–—|]/)[0] || text;
}

function isCloseMatch(songTitle, targetTitle) {
  const cleanSong = songTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  const cleanTarget = targetTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  
  if (cleanSong === cleanTarget) {
    return true;
  }
  
  const hasJapaneseOrChinese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(targetTitle);
  if (hasJapaneseOrChinese) {
    const corePart = extractCorePart(targetTitle);
    if (songTitle.includes(corePart)) {
      return true;
    }
  }
  
  return false;
}

function extractCorePart(text) {
  const japaneseOrChineseMatch = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  return japaneseOrChineseMatch ? japaneseOrChineseMatch[0] : text.split(/\s+/)[0];
}

function calculateDuration(interval) {
  if (!interval) return 0;
  
  if (typeof interval === 'string') {
    if (interval.includes('分') && interval.includes('秒')) {
      const match = interval.match(/(\d+)分(\d+)秒/);
      if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
    } else if (interval.includes(':')) {
      const [minutes, seconds] = interval.split(':').map(Number);
      if (!isNaN(minutes) && !isNaN(seconds)) return minutes * 60 + seconds;
    } else if (!isNaN(Number(interval))) {
      return Number(interval);
    }
  } else if (typeof interval === 'number') {
    return interval;
  }
  
  return 0;
}

function isProductionLine(text) {
  const productionKeywords = [
    '词', '曲', '编曲', '制作人', '合声', '合声编写', '吉他', '贝斯', '鼓',
    '录音助理', '录音工程', '混音工程', '录音', '混音', '工程', '助理', '编写',
    'lyrics', 'lyric', 'composed', 'compose', 'producer', 'produce', 'produced'
  ];
  
  for (const keyword of productionKeywords) {
    if (text.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

function isLicenseWarningLine(text) {
  if (!text) return false;
  
  const specialKeywords = ['文曲大模型', '享有本翻译作品的著作权'];
  for (const keyword of specialKeywords) {
    if (text.includes(keyword)) return true;
  }
  
  const tokens = ['未经', '许可', '授权', '不得', '请勿', '使用', '版权', '翻唱'];
  let count = 0;
  for (const token of tokens) {
    if (text.includes(token)) count += 1;
  }
  return count >= 3;
}

function getEmptyLyrics() {
  return { 
    syncedLyrics: '', 
    plainLyrics: '', 
    translatedLyrics: '',
    yrcLyrics: ''
  };
}
