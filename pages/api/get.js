import axios from 'axios';
import crypto from 'crypto';
import zlib from 'zlib';

// 歌曲映射表
const songMapping = {
  '突然的自我_伍佰': '004M9W2J4N2T2d',
  '挪威的森林_伍佰': '000bC3V82XQ3Yc',
  'Last Dance_伍佰': '0022c9JL2nz3xr',
  '世界第一等_伍佰': '0022c9JL2nz3xr',
  '爱情的尽头_伍佰': '003GBqH10sS2qY',
  '白鸽_伍佰': '000w0pKK0dL4Nk',
  '爱你一万年_伍佰': '002Yp2Ak3qYq0c',
  '浪人情歌_伍佰': '002Yp2Ak3qYq0c',
  '被动_伍佰': '000b7aX41eNQsX',
  '牵挂_伍佰': '003GBqH10sS2qY',
  '光辉岁月_Beyond': '004Z8Ihr0JIu5V',
  '海阔天空_Beyond': '0039MmK33cJK48',
  '真的爱你_Beyond': '001Lr98F4Xv5Yd',
  '喜欢你_Beyond': '0028WlEM3hIv0d',
  '北京一夜_陈升': '002Yp2Ak3qYq0c',
  '把悲伤留给自己_陈升': '003GBqH10sS2qY',
  'unrequited_林宥嘉': '002YCqIb3Jw4Yl',
  'fool_林宥嘉': '002YCqIb3Jw4Yl',
  'who doesn\'t wanna_林宥嘉': '0039MmK33cJK48',
  'dong_动力火车': '004M9W2J4N2T2d',
};

export default async function handler(req, res) {
  // CORS设置
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
      message: 'trackName/track_name和artistName/artist_name参数都是必需的'
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
    
    // 搜索
    const song = await searchSong(processedTrackName, processedArtists, finalTrackName, finalArtistName);
    
    if (!song) {
      return res.status(404).json({ error: 'Song not found', message: '未找到匹配的歌曲' });
    }
    
    console.log('找到歌曲:', { name: getSongName(song), artist: extractArtists(song), id: song.id });
    
    // 获取歌词
    const [lyrics, yrcLyrics] = await Promise.all([
      getLyrics(song.mid || song.id),
      getEncryptedLyrics(song.id)
    ]);
    
    // 返回结果
    const response = {
      id: song.id,
      mid: song.mid,
      name: getSongName(song) || finalTrackName,
      trackName: getSongName(song) || finalTrackName,
      artistName: extractArtists(song),
      albumName: extractAlbumName(song),
      duration: calculateDuration(song.interval),
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '',
      syncedLyrics: lyrics.syncedLyrics,
      translatedLyrics: lyrics.translatedLyrics,
      yrcLyrics: yrcLyrics || ''
    };
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API错误:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// ================ 修复的解密核心部分 ================

// 标准 DES-ECB 解密 (使用前8字节作为密钥)
function desEcbDecrypt(buffer, keyStr) {
  try {
    // 截取前8个字节作为 DES 密钥
    const keyBuffer = Buffer.from(keyStr.substring(0, 8), 'ascii');
    
    // 使用 des-ecb，且关闭自动填充 (NoPadding)
    // Node.js crypto: iv 传 null 或空 Buffer 即可
    const decipher = crypto.createDecipheriv('des-ecb', keyBuffer, null);
    decipher.setAutoPadding(false);
    
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
  } catch (error) {
    console.error(`DES解密失败 (Key: ${keyStr}):`, error.message);
    return buffer;
  }
}

// 标准 DES-ECB 加密 (使用前8字节作为密钥)
function desEcbEncrypt(buffer, keyStr) {
  try {
    const keyBuffer = Buffer.from(keyStr.substring(0, 8), 'ascii');
    
    const cipher = crypto.createCipheriv('des-ecb', keyBuffer, null);
    cipher.setAutoPadding(false);
    
    return Buffer.concat([cipher.update(buffer), cipher.final()]);
  } catch (error) {
    console.error(`DES加密失败 (Key: ${keyStr}):`, error.message);
    return buffer;
  }
}

// QRC 歌词解密主逻辑 (修复版)
function decryptQQMusicLyrics(encryptedHex) {
  try {
    console.log('=== 开始解密QRC歌词 (Fix版) ===');
    
    if (!encryptedHex) return '';
    
    // 1. 十六进制字符串转Buffer
    let buffer = Buffer.from(encryptedHex, 'hex');
    console.log('二进制长度:', buffer.length, '字节');
    
    // 2. 执行三步 DES 处理 (D -> E -> D)
    // 逻辑参考 C# DLL 调用顺序：
    // func_ddes(sbytes, "!@#)(NHLiuy*$%^&", sz);
    // func_des(sbytes, "123ZXC!@#)(*$%^&", sz);
    // func_ddes(sbytes, "!@#)(*$%^&abcDEF", sz);
    
    // 第一步：解密
    buffer = desEcbDecrypt(buffer, "!@#)(NHLiuy*$%^&");
    
    // 第二步：加密
    buffer = desEcbEncrypt(buffer, "123ZXC!@#)(*$%^&");
    
    // 第三步：解密
    buffer = desEcbDecrypt(buffer, "!@#)(*$%^&abcDEF");
    
    console.log('三步DES处理完成，前16字节:', buffer.slice(0, 16).toString('hex'));
    
    // 4. 解压缩数据
    let decompressedText = '';
    try {
      // 优先尝试标准 inflate
      const decompressedBuffer = zlib.inflateSync(buffer);
      decompressedText = decompressedBuffer.toString('utf8');
      console.log('zlib.inflateSync 解压成功');
    } catch (e1) {
      console.log('zlib.inflateSync 失败，尝试 raw inflate...');
      try {
        // 尝试 raw inflate (无头部)
        const decompressedBuffer = zlib.inflateRawSync(buffer);
        decompressedText = decompressedBuffer.toString('utf8');
        console.log('zlib.inflateRawSync 解压成功');
      } catch (e2) {
        console.log('zlib.inflateRawSync 失败，尝试 gunzip...');
        try {
          // 最后的尝试：可能是普通的 gzip
          const decompressedBuffer = zlib.gunzipSync(buffer);
          decompressedText = decompressedBuffer.toString('utf8');
          console.log('zlib.gunzipSync 解压成功');
        } catch (e3) {
           console.error('所有解压方式均失败，可能数据损坏或解密不正确');
           return '';
        }
      }
    }

    // 5. 处理 XML/Result
    if (!decompressedText) return '';

    // 移除可能的 BOM
    if (decompressedText.charCodeAt(0) === 0xFEFF) {
        decompressedText = decompressedText.slice(1);
    }

    console.log('解压后文本长度:', decompressedText.length);

    // 提取 XML 中的歌词内容
    let finalLyrics = '';
    if (decompressedText.includes('<?xml') || decompressedText.includes('<Lyric_1') || decompressedText.includes('LyricContent=')) {
      console.log('检测到XML格式，提取歌词内容...');
      finalLyrics = extractLyricFromXml(decompressedText);
    } else {
      finalLyrics = decompressedText;
    }
    
    return finalLyrics;
    
  } catch (error) {
    console.error('解密流程发生异常:', error);
    return '';
  }
}

// ================ 辅助工具函数 ================

// 解码HTML实体
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&apos;': "'"
  };
  
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;|&apos;/g, match => entities[match]);
}

// 改进的加密内容提取函数
function extractEncryptedContent(xmlText) {
  // 方法1: 查找CDATA中的内容
  const cdataMatch = xmlText.match(/<!\[CDATA\[(.*?)\]\]>/s);
  if (cdataMatch && cdataMatch[1]) {
    const content = cdataMatch[1].trim();
    if (/^[0-9A-Fa-f]+$/.test(content)) return content;
  }
  
  // 方法2: 查找<content>标签
  const contentMatch = xmlText.match(/<content[^>]*>([^<]+)<\/content>/i);
  if (contentMatch && contentMatch[1]) {
    const content = contentMatch[1].trim();
    if (/^[0-9A-Fa-f]+$/.test(content)) return content;
  }
  
  // 方法3: 查找长十六进制字符串 (兜底)
  const hexMatches = xmlText.match(/[0-9A-Fa-f]{200,}/g);
  if (hexMatches && hexMatches.length > 0) {
    return hexMatches.reduce((a, b) => a.length > b.length ? a : b);
  }
  
  return null;
}

// 从XML中提取歌词
function extractLyricFromXml(xmlText) {
  try {
    // 1. 尝试从 LyricContent 属性提取 (最常见)
    const lyricMatch1 = xmlText.match(/LyricContent="([^"]+)"/);
    if (lyricMatch1 && lyricMatch1[1]) {
      return decodeHtmlEntities(lyricMatch1[1]);
    }
    
    // 2. 尝试从 Lyric_1 标签提取
    const lyricMatch2 = xmlText.match(/<Lyric_1[^>]*>([\s\S]*?)<\/Lyric_1>/);
    if (lyricMatch2 && lyricMatch2[1]) {
      return decodeHtmlEntities(lyricMatch2[1]);
    }
    
    // 3. 尝试从 lyric 标签提取
    const lyricMatch3 = xmlText.match(/<lyric[^>]*>([\s\S]*?)<\/lyric>/);
    if (lyricMatch3 && lyricMatch3[1]) {
      return decodeHtmlEntities(lyricMatch3[1]);
    }
    
    return xmlText;
  } catch (error) {
    console.error('XML解析失败:', error);
    return xmlText;
  }
}

// ================ 获取加密歌词 ================

async function getEncryptedLyrics(songId) {
  try {
    console.log(`=== 开始获取逐字歌词，歌曲ID: ${songId} ===`);
    
    const params = new URLSearchParams({
      version: '15',
      miniversion: '82',
      lrctype: '4',
      musicid: songId
    });
    
    const response = await axios.get(`https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg?${params}`, {
      headers: {
        'Referer': 'https://c.y.qq.com/',
        'User-Agent': 'QQMusic/19.0.0.0'
      },
      timeout: 10000
    });
    
    let data = response.data;
    
    if (!data || data.length < 100) return '';
    
    // 移除XML注释
    data = data.replace(/<!--[\s\S]*?-->/g, '');
    
    // 提取加密内容
    const encryptedContent = extractEncryptedContent(data);
    
    if (!encryptedContent) {
      console.log('未找到加密内容');
      return '';
    }
    
    // 解密歌词
    const decryptedText = decryptQQMusicLyrics(encryptedContent);
    
    return decryptedText || '';
    
  } catch (error) {
    console.error('获取逐字歌词失败:', error.message);
    return '';
  }
}

// ================ 其他辅助函数 (保持原样) ================

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

async function handleMappedSong(mappedMid, originalTrackName, originalArtistName, res) {
  try {
    const lyrics = await getLyrics(mappedMid);
    const yrcLyrics = await getEncryptedLyrics(mappedMid);
    
    let songInfo = null;
    try {
      songInfo = await getSongInfoByMid(mappedMid);
    } catch (error) {
      console.log('无法获取歌曲信息，使用默认信息');
    }
    
    const response = {
      id: mappedMid,
      mid: mappedMid,
      name: songInfo ? getSongName(songInfo) : originalTrackName,
      trackName: songInfo ? getSongName(songInfo) : originalTrackName,
      artistName: songInfo ? extractArtists(songInfo) : originalArtistName,
      albumName: songInfo ? extractAlbumName(songInfo) : '',
      duration: songInfo ? calculateDuration(songInfo.interval) : 0,
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '',
      syncedLyrics: lyrics.syncedLyrics,
      translatedLyrics: lyrics.translatedLyrics,
      yrcLyrics: yrcLyrics || '',
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

async function getSongInfoByMid(mid) {
  try {
    const response = await axios.get(`https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${mid}&format=json`, {
      headers: { 'Referer': 'https://c.y.qq.com/' }
    });
    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0];
    }
    throw new Error('无法获取歌曲信息');
  } catch (error) {
    throw error;
  }
}

function preprocessArtists(artistName) {
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  return [...new Set(artists.filter(artist => artist.trim()))];
}

function preprocessTrackName(trackName) {
  const patterns = [
    / - genshin impact's.*$/i, / - .*anniversary.*$/i, / - .*theme song.*$/i,
    / - .*japanese.*$/i, / - .*version.*$/i, / - 《.*?》.*$/,
    / - .*动画.*$/, / - .*剧集.*$/, / - .*主题曲.*$/,
    /\(.*?\)/g, / - from the.*$/i, / - official.*$/i,
    / \(from.*\)/gi, / - remastered.*$/i, / - .*mix.*$/i,
    / - .*edit.*$/i, /《(.*?)》/g, /---/g, /———/g, / - $/,
  ];
  
  let processed = trackName;
  for (const pattern of patterns) {
    processed = processed.replace(pattern, '');
  }
  return processed.replace(/\s+/g, ' ').replace(/[-\s]+$/g, '').trim() || trackName.split(/[-\s–—]/)[0].trim();
}

async function searchSong(trackName, artists, originalTrackName, originalArtistName) {
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  if (shouldSimplify) {
    return await simplifiedSearch(trackName, artists, originalTrackName, originalArtistName);
  }
  
  for (const artist of artists) {
    try {
      const searchData = {
        req_1: {
          method: "DoSearchForQQMusicDesktop",
          module: "music.search.SearchCgiService",
          param: {
            num_per_page: 3, page_num: 1, query: trackName + ' ' + artist, search_type: 0
          }
        }
      };
      
      const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', searchData, {
        headers: { 'Referer': 'https://c.y.qq.com/', 'Content-Type': 'application/json' }
      });
      
      const data = response.data;
      if (data?.req_1?.data?.body?.song?.list?.length > 0) {
        const songs = transformSearchResults(data.req_1.data.body.song.list);
        const match = findBestMatch(songs, trackName, artists, originalTrackName, originalArtistName);
        if (match) return match;
      }
    } catch (error) {
      console.error('官方API搜索失败:', error);
    }
  }
  return null;
}

function transformSearchResults(songList) {
  return songList.map(song => ({
    id: song.id, mid: song.mid, name: song.name, title: song.name,
    singer: song.singer, album: song.album, interval: song.interval, songname: song.name
  }));
}

async function simplifiedSearch(trackName, artists, originalTrackName, originalArtistName) {
  const strategies = [
    () => {
      const coreName = extractCoreName(trackName);
      return artists.map(artist => `${coreName} ${artist}`);
    },
    () => {
      const processed = preprocessTrackName(trackName);
      return artists.map(artist => `${processed} ${artist}`);
    },
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    try {
      const keywords = strategies[i]();
      for (const keyword of keywords) {
        const searchData = {
          req_1: {
            method: "DoSearchForQQMusicDesktop",
            module: "music.search.SearchCgiService",
            param: { num_per_page: "3", page_num: "1", query: keyword, search_type: 0 }
          }
        };
        
        const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', searchData, {
          headers: { 'Referer': 'https://c.y.qq.com/', 'Content-Type': 'application/json' }
        });
        
        const data = response.data;
        if (data?.req_1?.data?.body?.song?.list?.length > 0) {
          const songs = transformSearchResults(data.req_1.data.body.song.list);
          const match = findBestMatch(songs, trackName, artists, originalTrackName, originalArtistName);
          if (match) return match;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {}
  }
  return null;
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

function findBestMatch(results, targetTrack, artists, originalTrackName, originalArtistName) {
  const exactMatch = findExactMatch(results, originalTrackName, originalArtistName);
  if (exactMatch) return exactMatch;
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const song of results) {
    const score = calculateSmartScore(song, targetTrack, artists, originalTrackName, originalArtistName);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  return bestMatch || (results.length > 0 ? results[0] : null);
}

function findExactMatch(results, originalTrackName, originalArtistName) {
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    if (songName && songArtists) {
      if (songName.toLowerCase() === trackLower && songArtists.toLowerCase() === artistLower) {
        return song;
      }
    }
  }
  return null;
}

function calculateSmartScore(song, targetTrack, artists, originalTrackName, originalArtistName) {
  const songName = getSongName(song);
  if (!songName) return 0;
  
  const songTitle = songName.toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  const originalTrackNameLower = originalTrackName.toLowerCase();
  const originalArtistNameLower = originalArtistName.toLowerCase();
  
  let titleScore = 0;
  let artistScore = 0;
  
  if (songTitle === originalTrackNameLower) titleScore = 100;
  else if (songTitle === targetTrackLower) titleScore = 90;
  else if (isCloseMatch(songTitle, originalTrackNameLower)) titleScore = 80;
  else if (isCloseMatch(songTitle, targetTrackLower) || songTitle.includes(targetTrackLower)) titleScore = 70;
  
  const songArtistsArray = songArtists.split(/\s*,\s*|\s+&\s+/);
  for (const targetArtist of artists) {
    const targetArtistLower = targetArtist.toLowerCase();
    for (const songArtist of songArtistsArray) {
      if (songArtist === originalArtistNameLower) { artistScore = Math.max(artistScore, 100); break; }
      else if (songArtist === targetArtistLower) { artistScore = Math.max(artistScore, 80); break; }
      else if (songArtist.includes(targetArtistLower) || targetArtistLower.includes(songArtist)) { artistScore = Math.max(artistScore, 40); break; }
    }
  }
  
  let totalScore = (titleScore * 0.6) + (artistScore * 0.4);
  if (titleScore >= 70 && artistScore >= 80) totalScore += 15;
  return totalScore;
}

function isCloseMatch(songTitle, targetTitle) {
  const cleanSong = songTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  const cleanTarget = targetTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  if (cleanSong === cleanTarget) return true;
  const hasJapaneseOrChinese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(targetTitle);
  if (hasJapaneseOrChinese) {
    const corePart = extractCorePart(targetTitle);
    if (songTitle.includes(corePart)) return true;
  }
  return false;
}

function extractCorePart(text) {
  const japaneseOrChineseMatch = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  return japaneseOrChineseMatch ? japaneseOrChineseMatch[0] : text.split(/\s+/)[0];
}

function getSongName(song) {
  return song.song || song.name || song.songname || song.title || song.songName;
}

function extractArtists(song) {
  if (!song.singer) return '';
  if (Array.isArray(song.singer)) {
    return song.singer.map(s => (typeof s === 'object' ? s.name || s.title || s.singer_name || '' : String(s))).filter(Boolean).join(', ');
  }
  return typeof song.singer === 'object' ? song.singer.name || song.singer.title || '' : String(song.singer);
}

function extractAlbumName(song) {
  if (!song.album) return '';
  return typeof song.album === 'object' ? song.album.name || song.album.title || '' : String(song.album);
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
    } else if (!isNaN(Number(interval))) return Number(interval);
  } else if (typeof interval === 'number') return interval;
  return 0;
}

// 获取普通歌词
async function getLyrics(songMid) {
  try {
    const currentMillis = Date.now();
    const callback = 'MusicJsonCallback_lrc';
    const params = new URLSearchParams({
      callback: callback, pcachetime: currentMillis.toString(), songmid: songMid,
      g_tk: '5381', jsonpCallback: callback, loginUin: '0', hostUin: '0',
      format: 'jsonp', inCharset: 'utf8', outCharset: 'utf8', notice: '0', platform: 'yqq', needNewCode: '0'
    });
    
    const response = await axios.get(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`, {
      headers: { 'Referer': 'https://c.y.qq.com/' }
    });
    
    let data = response.data;
    if (data.startsWith(callback)) data = data.replace(callback + '(', '').slice(0, -1);
    
    const lyricData = JSON.parse(data);
    let syncedLyrics = '', translatedLyrics = '';
    
    if (lyricData.lyric) syncedLyrics = filterLyricsWithNewRules(Buffer.from(lyricData.lyric, 'base64').toString('utf-8'));
    if (lyricData.trans) translatedLyrics = filterLyricsWithNewRules(Buffer.from(lyricData.trans, 'base64').toString('utf-8'));
    
    return { syncedLyrics, plainLyrics: '', translatedLyrics };
  } catch (error) {
    console.error('获取歌词失败:', error);
    return { syncedLyrics: '', plainLyrics: '', translatedLyrics: '' };
  }
}

function filterLyricsWithNewRules(lyricContent) {
  if (!lyricContent) return '';
  const lines = lyricContent.replace(/\r\n/g, '\n').split('\n');
  const filteredLines = lines.filter(line => !/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(line.trim()));
  
  const parsedLines = [];
  for (const line of filteredLines) {
    const match = line.match(/^(\[[0-9:.]+\])(.*)$/);
    if (match) parsedLines.push({ raw: line, timestamp: match[1], text: match[2].trim(), plainText: match[2].trim().replace(/\[.*?\]/g, '') });
  }
  
  let filtered = [...parsedLines];
  let i = 0;
  let scanLimit = Math.min(3, filtered.length);
  
  while (i < scanLimit) {
    if (filtered[i].plainText.includes('-') || containsColon(filtered[i].plainText)) {
      filtered.splice(i, 1);
      scanLimit = Math.min(3, filtered.length);
    } else {
      i++;
    }
  }
  
  filtered = filtered.filter(line => !containsBracketTag(line.plainText) && !containsParenPair(line.plainText) && !isLicenseWarningLine(line.plainText));
  filtered = filtered.filter(line => {
    const text = line.plainText;
    if (text === '' || text === '//' || /^\/\/\s*$/.test(text)) return false;
    if (/^\[\d+:\d+(\.\d+)?\]\s*(\/\/)?\s*$/.test(line.raw)) return false;
    return true;
  });
  
  return filtered.map(line => line.raw).join('\n');
}

function containsColon(text) { return text.includes(':') || text.includes('：'); }
function containsBracketTag(text) { return (text.includes('[') && text.includes(']')) || (text.includes('【') && text.includes('】')); }
function containsParenPair(text) { return (text.includes('(') && text.includes(')')) || (text.includes('（') && text.includes('）')); }
function isLicenseWarningLine(text) {
  if (!text) return false;
  if (['文曲大模型', '享有本翻译作品的著作权'].some(k => text.includes(k))) return true;
  const tokens = ['未经', '许可', '授权', '不得', '请勿', '使用', '版权', '翻唱'];
  return tokens.filter(t => text.includes(t)).length >= 3;
}
