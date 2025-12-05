import axios from 'axios';
import xml2js from 'xml2js';
import crypto from 'crypto';
import pako from 'pako';
import { parseStringPromise } from 'xml2js';

// QQ音乐DES解密密钥
const QQ_KEY = '!@#)(*$%123ZXC!@!@#)(NHL';

// 歌曲映射表 - 直接映射到对应的MID
const songMapping = {
  // 格式: '歌名_艺人': 'MID'
  
  // 歌单匹配错误
  '無條件_陳奕迅': '001HpGqo4daJ21',
  '一樣的月光_徐佳瑩': '001KyJTt1kbkfP',
  '拉过勾的_陸虎': '004QCuMF2nVaxn',
  '人生馬拉松_陳奕迅': '004J2NXe3bwkjk',
  
  // 李志
  '天空之城_李志': '002QU4XI2cKwua',
  '關於鄭州的記憶_李志': '002KPXam27DeEJ',
  
  // 吴亦凡
  '大碗宽面_吳亦凡': '001JceuO3lQbyN',
  'November Rain_吳亦凡': '000RQ1Hy29awJd',
  'July_吳亦凡': '001fszA13qSD04',

  // 可以继续添加更多映射...
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
      name: song.name || song.title, 
      artist: extractArtistsOfficial(song), 
      id: song.id,
      mid: song.mid
    });
    
    // 获取歌词 - 使用官方API并解密
    const lyrics = await getLyricsOfficial(song.mid || song.id);
    
    // 返回结果
    const response = {
      id: song.id,
      mid: song.mid,
      name: song.name || song.title || finalTrackName,
      trackName: song.name || song.title || finalTrackName,
      artistName: extractArtistsOfficial(song),
      albumName: extractAlbumNameOfficial(song),
      duration: calculateDuration(song.interval || song.duration),
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '', // 设置为空字符串
      syncedLyrics: lyrics.syncedLyrics,
      translatedLyrics: lyrics.translatedLyrics,
      yrcLyrics: lyrics.yrcLyrics // 新增 yrcLyrics 字段
    };
    
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// 检查歌曲映射
function checkSongMapping(processedTrackName, processedArtists, originalTrackName, originalArtistName) {
  // 尝试多种键格式进行匹配
  const possibleKeys = [
    `${processedTrackName}_${processedArtists[0]}`,
    `${originalTrackName}_${originalArtistName}`,
    `${processedTrackName}_${originalArtistName}`,
    `${originalTrackName}_${processedArtists[0]}`,
    // 对于英文歌名，也尝试小写匹配
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
    // 对于映射歌曲，使用MID获取歌词
    const lyrics = await getLyricsOfficial(mappedMid);
    
    // 尝试获取歌曲信息
    let songInfo = null;
    try {
      songInfo = await getSongInfoOfficial(mappedMid);
    } catch (error) {
      console.log('无法获取歌曲信息，使用默认信息');
    }
    
    const response = {
      id: mappedMid,
      mid: mappedMid,
      name: songInfo ? (songInfo.name || songInfo.title) : originalTrackName,
      trackName: songInfo ? (songInfo.name || songInfo.title) : originalTrackName,
      artistName: songInfo ? extractArtistsOfficial(songInfo) : originalArtistName,
      albumName: songInfo ? extractAlbumNameOfficial(songInfo) : '',
      duration: songInfo ? calculateDuration(songInfo.interval || songInfo.duration) : 0,
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '',
      syncedLyrics: lyrics.syncedLyrics,
      translatedLyrics: lyrics.translatedLyrics,
      yrcLyrics: lyrics.yrcLyrics,
      isMapped: true, // 标记这是映射版本
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
  // 判断是否需要简化搜索
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  // 尝试不同的搜索策略
  const strategies = [
    // 策略1: 核心歌名 + 艺术家
    () => {
      const coreName = extractCoreName(trackName);
      return artists.map(artist => `${coreName} ${artist}`);
    },
    // 策略2: 预处理歌名 + 艺术家
    () => {
      const processed = preprocessTrackName(trackName);
      return artists.map(artist => `${processed} ${artist}`);
    },
    // 策略3: 只使用核心歌名
    () => {
      const coreName = extractCoreName(trackName);
      return [coreName];
    }
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    try {
      const keywords = strategies[i]();
      
      for (const keyword of keywords) {
        // 使用官方搜索API
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
      w: keyword,
      p: 1,
      n: 20,
      format: 'json',
      outCharset: 'utf-8',
      t: 0
    };
    
    const response = await axios.get(searchUrl, {
      params,
      headers: {
        'Referer': 'https://c.y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // 解析QQ音乐返回的数据
    if (response.data && response.data.data && response.data.data.song && response.data.data.song.list) {
      return response.data.data.song.list;
    }
    
    return [];
  } catch (error) {
    console.error('官方搜索失败:', error);
    return [];
  }
}

// 通过MID获取歌曲信息（官方API）
async function getSongInfoOfficial(mid) {
  try {
    const response = await axios.get('https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg', {
      params: {
        songmid: mid,
        format: 'json',
        jsonpCallback: 'getOneSongInfoCallback'
      },
      headers: {
        'Referer': 'https://c.y.qq.com/'
      }
    });
    
    // 处理JSONP响应
    let dataStr = response.data;
    if (typeof dataStr === 'string' && dataStr.startsWith('getOneSongInfoCallback(')) {
      dataStr = dataStr.replace('getOneSongInfoCallback(', '').slice(0, -1);
      const data = JSON.parse(dataStr);
      if (data.data && data.data.length > 0) {
        return data.data[0];
      }
    }
    
    throw new Error('无法获取歌曲信息');
  } catch (error) {
    throw error;
  }
}

// 查找最佳匹配（官方API结果）
function findBestMatchOfficial(results, targetTrack, artists, originalTrackName, originalArtistName) {
  // 先尝试精确匹配（歌曲名和艺术家都匹配）
  const exactMatch = findExactMatchOfficial(results, originalTrackName, originalArtistName);
  if (exactMatch) return exactMatch;
  
  // 使用更智能的评分系统
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

// 精确匹配 - 官方API
function findExactMatchOfficial(results, originalTrackName, originalArtistName) {
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  for (const song of results) {
    const songName = getSongNameOfficial(song);
    const songArtists = extractArtistsOfficial(song);
    
    if (songName && songArtists) {
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      // 要求歌曲名和艺术家都完全匹配
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
        return song;
      }
    }
  }
  
  return null;
}

// 更智能的评分系统 - 官方API
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
  
  // 计算歌曲名匹配分数
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
  
  // 计算艺术家匹配分数
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
  
  // 计算综合分数
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
  
  // 特殊情况处理
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

// 获取歌曲名称 - 官方API
function getSongNameOfficial(song) {
  return song.songname || song.name || song.title || song.songName;
}

// 提取歌手信息 - 官方API
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

// 提取专辑信息 - 官方API
function extractAlbumNameOfficial(song) {
  if (!song.album) return '';
  if (typeof song.album === 'object') return song.album.name || song.album.title || '';
  return String(song.album);
}

// 使用官方API获取歌词并解密
async function getLyricsOfficial(songMid) {
  try {
    // 使用官方接口获取加密歌词
    const encryptedLyrics = await getEncryptedLyricsOfficial(songMid);
    
    if (!encryptedLyrics) {
      return getEmptyLyrics();
    }
    
    // 解密歌词
    const decryptedLyrics = await processEncryptedLyrics(encryptedLyrics);
    
    return decryptedLyrics;
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 获取加密歌词（官方API）
async function getEncryptedLyricsOfficial(songMid) {
  try {
    // 使用官方接口获取加密歌词
    const response = await axios.get('https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg', {
      params: {
        version: '15',
        miniversion: '82',
        lrctype: '4',
        musicid: songMid
      },
      headers: {
        'Referer': 'https://c.y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // 处理响应（可能是XML格式）
    return response.data;
  } catch (error) {
    console.error('获取加密歌词失败:', error);
    return null;
  }
}

// 处理加密歌词
async function processEncryptedLyrics(xmlData) {
  try {
    // 移除XML注释
    const cleanedXml = xmlData.replace(/<!--/g, '').replace(/-->/g, '');
    
    // 解析XML
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(cleanedXml);
    
    let lyrics = '';
    let trans = '';
    let yrc = '';
    
    // 递归查找歌词节点
    function findLyricsNodes(node, path = '') {
      if (typeof node === 'object' && node !== null) {
        for (const key in node) {
          const newPath = path ? `${path}.${key}` : key;
          
          // 检查是否为歌词节点
          if (key === 'content' || key === 'contentts' || key === 'Lyric_1' || key === 'contentroma') {
            const value = node[key];
            if (typeof value === 'string' && value.trim()) {
              try {
                // 解密歌词
                const decrypted = decryptLyrics(value);
                
                // 进一步处理解密后的内容
                const processed = processDecryptedLyrics(decrypted);
                
                // 根据节点类型分配
                if (key === 'content') {
                  lyrics = processed;
                } else if (key === 'contentts') {
                  trans = processed;
                } else if (key === 'Lyric_1') {
                  yrc = processed;
                }
              } catch (err) {
                console.warn(`解密失败 (${key}):`, err.message);
              }
            }
          } else if (typeof node[key] === 'object') {
            findLyricsNodes(node[key], newPath);
          } else if (Array.isArray(node[key])) {
            node[key].forEach((item, index) => {
              findLyricsNodes(item, `${newPath}[${index}]`);
            });
          }
        }
      }
    }
    
    findLyricsNodes(result);
    
    // 过滤处理
    const filteredLyrics = filterLyrics(lyrics, 'lrc');
    const filteredTrans = filterLyrics(trans, 'lrc');
    const filteredYrc = filterYrcLyricsFallback(yrc);
    
    return {
      syncedLyrics: filteredLyrics,
      plainLyrics: '',
      translatedLyrics: filteredTrans,
      yrcLyrics: filteredYrc
    };
    
  } catch (error) {
    console.error('处理加密歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 解密歌词（实现C#中的DES解密逻辑）
function decryptLyrics(encryptedHex) {
  try {
    // 将十六进制字符串转换为Buffer
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    
    // 3DES解密（ECB模式）
    const key = Buffer.from(QQ_KEY, 'binary');
    const decipher = crypto.createDecipheriv('des-ede3', key, Buffer.alloc(0));
    
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // 解压缩（使用pako库，类似于SharpZipLib）
    const decompressed = pako.inflate(decrypted);
    
    // 移除BOM（如果存在）
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    let resultBuffer = Buffer.from(decompressed);
    
    if (resultBuffer.slice(0, 3).equals(bom)) {
      resultBuffer = resultBuffer.slice(3);
    }
    
    // 转换为字符串
    return resultBuffer.toString('utf-8');
  } catch (error) {
    console.error('解密失败:', error);
    throw error;
  }
}

// 处理解密后的歌词
function processDecryptedLyrics(decryptedText) {
  if (!decryptedText) return '';
  
  // 检查是否为XML格式
  if (decryptedText.includes('<?xml') || decryptedText.includes('<Lyric_')) {
    try {
      // 提取LyricContent属性
      const match = decryptedText.match(/LyricContent="([^"]*)"/);
      if (match && match[1]) {
        return match[1];
      }
    } catch (err) {
      console.warn('解析XML歌词失败:', err.message);
    }
  }
  
  // 如果不是XML，直接返回
  return decryptedText;
}

// 统一的歌词过滤函数
function filterLyrics(lyricContent, type = 'lrc') {
  if (!lyricContent || lyricContent.trim() === '') return '';
  
  const lines = lyricContent.replace(/\r\n/g, '\n').split('\n');
  const filteredLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 跳过元数据行
    if (/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed)) {
      continue;
    }
    
    // 跳过空行
    if (trimmed === '') {
      continue;
    }
    
    // 跳过明显的版权/制作信息
    if (isLicenseWarningLine(trimmed)) {
      continue;
    }
    
    // 跳过包含标签的行
    if (containsBracketTag(trimmed)) {
      continue;
    }
    
    filteredLines.push(line);
  }
  
  return filteredLines.join('\n');
}

// YRC歌词过滤备用方案
function filterYrcLyricsFallback(yrcContent) {
  if (!yrcContent || yrcContent.trim() === '') return '';
  
  const lines = yrcContent.replace(/\r\n/g, '\n').split('\n');
  const filteredLines = [];
  let foundLyricsStart = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === '') continue;
    
    // 跳过明显的制作信息
    if (isProductionLine(trimmed, 0)) {
      continue;
    }
    
    // 跳过版权警告
    if (isLicenseWarningLine(trimmed)) {
      continue;
    }
    
    // 一旦找到非制作信息的行，开始收集
    if (!foundLyricsStart && !isProductionLine(trimmed, 0)) {
      foundLyricsStart = true;
    }
    
    if (foundLyricsStart) {
      filteredLines.push(line);
    }
  }
  
  return filteredLines.join('\n');
}

// 以下辅助函数保持不变（从原代码中保留）

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

function containsColon(text) {
  return text.includes(':') || text.includes('：');
}

function containsBracketTag(text) {
  const hasHalfPair = text.includes('[') && text.includes(']');
  const hasFullPair = text.includes('【') && text.includes('】');
  return hasHalfPair || hasFullPair;
}

function containsParenPair(text) {
  const hasHalfPair = text.includes('(') && text.includes(')');
  const hasFullPair = text.includes('（') && text.includes('）');
  return hasHalfPair || hasFullPair;
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

function isProductionLine(plainText, startTime) {
  const productionKeywords = [
    '词', '曲', '编曲', '制作人', '合声', '合声编写', '吉他', '贝斯', '鼓',
    '录音助理', '录音工程', '混音工程', '录音', '混音', '工程', '助理', '编写',
    'lyrics', 'lyric', 'composed', 'compose', 'producer', 'produce', 'produced'
  ];
  
  for (const keyword of productionKeywords) {
    if (plainText.includes(keyword)) {
      return true;
    }
  }
  
  if (containsColon(plainText)) {
    return true;
  }
  
  return false;
}

function getEmptyLyrics() {
  return { 
    syncedLyrics: '', 
    plainLyrics: '', 
    translatedLyrics: '',
    yrcLyrics: ''
  };
}
