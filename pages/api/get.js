import axios from 'axios';
import xml2js from 'xml2js';
import pako from 'pako';
import crypto from 'crypto';

// QQ音乐DES解密密钥
const QQ_KEY = '!@#)(*$%123ZXC!@!@#)(NHL';

// 歌曲映射表
const songMapping = {
  // ... 保持原有映射不变
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
    
    // 获取歌词 - 使用官方API并解密
    const lyrics = await getLyricsOfficial(song.mid || song.songmid || song.id);
    
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

// XML预处理函数 - 仿照C#中的XmlUtils
function preprocessXml(xml) {
  if (!xml) return '';
  
  // 1. 移除XML注释
  let processed = xml.replace(/<!--/g, '').replace(/-->/g, '');
  
  // 2. 替换未转义的&符号
  const ampRegex = /&(?![a-zA-Z]{2,6};|#[0-9]{2,4};)/g;
  processed = processed.replace(ampRegex, '&amp;');
  
  // 3. 处理属性中的引号问题（简化版）
  const quotRegex = /(\s+[\w:.-]+\s*=\s*")(([^"]*)((")((?!\s+[\w:.-]+\s*=\s*"|\s*(?:\/?|\?)>))[^"]*)*)"/g;
  
  processed = processed.replace(quotRegex, (match, p1, p2) => {
    return p1 + p2.replace(/"/g, '&quot;') + '"';
  });
  
  // 4. 移除非法内容（简化版）
  // 查找并修复格式错误的标签，如 <a="b" />
  const tagRegex = /<(\w+)([^>]*?)\/>/g;
  processed = processed.replace(tagRegex, (match, tagName, attributes) => {
    // 如果属性中有等号但没有空格分隔，可能是格式错误
    if (attributes.includes('=') && !attributes.includes(' ')) {
      return ''; // 移除这个标签
    }
    return match;
  });
  
  return processed.trim();
}

// 使用官方API搜索歌曲 - 修复版
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

// 使用官方API搜索 - 修复版
async function searchOfficialAPI(keyword) {
  try {
    // 使用更稳定的搜索接口
    const searchUrl = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
    const params = {
      w: keyword,
      p: 1,
      n: 20,
      format: 'json',
      outCharset: 'utf-8',
      t: 0, // 搜索类型：0-单曲
      cr: 1, // 不知道作用，但官方有
      g_tk: 5381
    };
    
    const response = await axios.get(searchUrl, {
      params,
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Origin': 'https://y.qq.com'
      }
    });
    
    // 解析QQ音乐返回的JSONP格式（如果是的话）
    let data = response.data;
    if (typeof data === 'string') {
      // 可能是JSONP格式
      if (data.includes('callback(')) {
        const match = data.match(/callback\(({.*})\)/);
        if (match) {
          try {
            data = JSON.parse(match[1]);
          } catch (e) {
            console.error('解析JSONP失败:', e);
            return [];
          }
        }
      }
    }
    
    // 提取歌曲列表
    if (data && data.data && data.data.song && data.data.song.list) {
      return data.data.song.list.map(song => ({
        songid: song.songid,
        songmid: song.songmid,
        songname: song.songname,
        singer: song.singer,
        albumname: song.albumname,
        albummid: song.albummid,
        interval: song.interval
      }));
    }
    
    return [];
  } catch (error) {
    console.error('官方搜索失败:', error.message);
    return [];
  }
}

// 使用官方API获取歌曲详情
async function getSongInfoOfficial(mid) {
  try {
    const response = await axios.get('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg', {
      params: {
        songmid: mid,
        format: 'json',
        jsonpCallback: 'getOneSongInfoCallback'
      },
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    let data = response.data;
    if (typeof data === 'string') {
      if (data.startsWith('getOneSongInfoCallback(')) {
        data = data.replace('getOneSongInfoCallback(', '').slice(0, -1);
        try {
          data = JSON.parse(data);
        } catch (e) {
          throw new Error('解析歌曲信息失败');
        }
      }
    }
    
    if (data && data.data && data.data.length > 0) {
      return data.data[0];
    }
    
    throw new Error('无法获取歌曲信息');
  } catch (error) {
    throw error;
  }
}

// 使用官方API获取歌词并解密 - 修复版
async function getLyricsOfficial(songMid) {
  try {
    // 首先尝试获取标准歌词
    const standardLyrics = await getStandardLyrics(songMid);
    
    // 然后尝试获取QRC歌词（逐字歌词）
    const qrcLyrics = await getQrcLyrics(songMid);
    
    return {
      syncedLyrics: standardLyrics.lyric || '',
      plainLyrics: '',
      translatedLyrics: standardLyrics.trans || '',
      yrcLyrics: qrcLyrics
    };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 获取标准歌词
async function getStandardLyrics(songMid) {
  try {
    const currentMillis = Date.now();
    const callback = 'MusicJsonCallback_lrc';
    
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
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    let data = response.data;
    if (typeof data === 'string' && data.startsWith(callback)) {
      data = data.replace(callback + '(', '').slice(0, -1);
      try {
        data = JSON.parse(data);
      } catch (e) {
        throw new Error('解析歌词JSON失败');
      }
    }
    
    if (data && data.code === 0) {
      // 解码Base64编码的歌词
      const result = {
        lyric: '',
        trans: ''
      };
      
      if (data.lyric) {
        result.lyric = Buffer.from(data.lyric, 'base64').toString('utf-8');
      }
      
      if (data.trans) {
        result.trans = Buffer.from(data.trans, 'base64').toString('utf-8');
      }
      
      return result;
    }
    
    throw new Error('获取歌词失败');
  } catch (error) {
    throw error;
  }
}

// 获取QRC歌词（逐字歌词）
async function getQrcLyrics(songMid) {
  try {
    const response = await axios.get('https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg', {
      params: {
        version: '15',
        miniversion: '82',
        lrctype: '4',
        musicid: songMid
      },
      headers: {
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const xmlData = response.data;
    
    // 预处理XML
    const processedXml = preprocessXml(xmlData);
    
    if (!processedXml) {
      return '';
    }
    
    // 尝试使用正则表达式提取加密内容，避免XML解析问题
    const encryptedText = extractEncryptedText(processedXml);
    
    if (!encryptedText) {
      return '';
    }
    
    // 解密歌词
    const decrypted = decryptLyrics(encryptedText);
    
    if (!decrypted) {
      return '';
    }
    
    // 处理解密后的内容
    return processDecryptedLyrics(decrypted);
    
  } catch (error) {
    console.error('获取QRC歌词失败:', error.message);
    return '';
  }
}

// 从XML中提取加密文本（使用正则表达式避免XML解析问题）
function extractEncryptedText(xml) {
  // 尝试匹配多种可能的标签
  const patterns = [
    /<content>([^<]+)<\/content>/,
    /<contentts>([^<]+)<\/contentts>/,
    /<contentroma>([^<]+)<\/contentroma>/,
    /<Lyric_1[^>]*>([^<]+)<\/Lyric_1>/,
    /LyricContent="([^"]+)"/,
    /<Lyric_1[^>]*LyricContent="([^"]+)"[^>]*\/>/,
    /<Lyric_1[^>]*>([\s\S]*?)<\/Lyric_1>/
  ];
  
  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match && match[1]) {
      const text = match[1].trim();
      // 检查是否是十六进制字符串
      if (/^[0-9a-fA-F]+$/.test(text)) {
        console.log('找到加密文本，长度:', text.length);
        return text;
      }
    }
  }
  
  return null;
}

// DES解密函数
function decryptLyrics(encryptedHex) {
  try {
    // 将十六进制字符串转换为Buffer
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    
    // 3DES解密（ECB模式，无IV）
    const key = Buffer.from(QQ_KEY, 'binary');
    
    // 注意：C#代码中使用了3DES ECB模式，Node.js中需要特殊处理
    const decipher = crypto.createDecipheriv('des-ede3', key, Buffer.alloc(0));
    decipher.setAutoPadding(true);
    
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // 尝试解压缩（使用pako）
    try {
      const decompressed = pako.inflate(decrypted);
      decrypted = Buffer.from(decompressed);
    } catch (e) {
      // 可能不是压缩数据，继续使用原始数据
      console.log('解压缩失败，使用原始数据');
    }
    
    // 移除UTF-8 BOM（如果存在）
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
  
  // 检查是否为XML格式
  if (decryptedText.includes('<?xml') || decryptedText.includes('<Lyric_')) {
    try {
      // 尝试提取LyricContent属性
      const match = decryptedText.match(/LyricContent="([^"]*)"/);
      if (match && match[1]) {
        return match[1];
      }
      
      // 尝试提取<Lyric_1>标签内容
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

// 以下辅助函数保持不变（从原代码中保留）
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
    const lyrics = await getLyricsOfficial(mappedMid);
    
    let songInfo = null;
    try {
      songInfo = await getSongInfoOfficial(mappedMid);
    } catch (error) {
      console.log('无法获取歌曲信息，使用默认信息');
    }
    
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
  } else if (songTitle.includes(originalTrackNameLower) && originalTrackNameLower.length > 3) {
    titleScore = 60;
  } else if (originalTrackNameLower.includes(songTitle) && songTitle.length > 3) {
    titleScore = 50;
  } else if (songTitle.includes(targetTrackLower) && targetTrackLower.length > 3) {
    titleScore = 40;
  } else if (targetTrackLower.includes(songTitle) && songTitle.length > 3) {
    titleScore = 30;
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

function getEmptyLyrics() {
  return { 
    syncedLyrics: '', 
    plainLyrics: '', 
    translatedLyrics: '',
    yrcLyrics: ''
  };
}
