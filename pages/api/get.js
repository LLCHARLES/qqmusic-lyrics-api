import axios from 'axios';

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

// ================ 逐字歌词相关函数 ================

// 获取加密歌词
async function getEncryptedLyrics(songId) {
  try {
    console.log(`=== 开始获取逐字歌词，歌曲ID: ${songId} ===`);
    
    const params = new URLSearchParams({
      version: '15',
      miniversion: '82',
      lrctype: '4',
      musicid: songId
    });
    
    console.log('请求URL: https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg');
    console.log('请求参数:', params.toString());
    
    const response = await axios.get(`https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg?${params}`, {
      headers: {
        'Referer': 'https://c.y.qq.com/'
      },
      timeout: 10000
    });
    
    let data = response.data;
    console.log('API响应长度:', data.length);
    
    // 检查响应是否包含预期内容
    if (!data || data.length < 100) {
      console.log('响应内容过短，可能无效');
      return '';
    }
    
    console.log('API响应前500字符:', data.substring(0, 500));
    
    // 移除XML注释
    data = data.replace(/<!--|-->/g, '');
    console.log('移除注释后长度:', data.length);
    
    // 尝试多种方式解析加密内容
    let encryptedContent = '';
    
    // 方法1: 尝试查找<content>标签
    const contentMatch = data.match(/<content[^>]*>([^<]+)<\/content>/);
    if (contentMatch && contentMatch[1]) {
      encryptedContent = contentMatch[1].trim();
      console.log('通过<content>标签找到加密内容，长度:', encryptedContent.length);
    }
    
    // 方法2: 如果方法1失败，尝试查找长十六进制字符串
    if (!encryptedContent) {
      const hexMatches = data.match(/[0-9A-Fa-f]{200,}/g);
      if (hexMatches && hexMatches.length > 0) {
        // 取最长的十六进制字符串
        encryptedContent = hexMatches.reduce((a, b) => a.length > b.length ? a : b);
        console.log('通过十六进制字符串找到加密内容，长度:', encryptedContent.length);
      }
    }
    
    // 方法3: 尝试查找CDATA中的内容
    if (!encryptedContent) {
      const cdataMatch = data.match(/<!\[CDATA\[(.*?)\]\]>/s);
      if (cdataMatch && cdataMatch[1]) {
        // 在CDATA中查找十六进制字符串
        const hexInCdata = cdataMatch[1].match(/[0-9A-Fa-f]{200,}/);
        if (hexInCdata) {
          encryptedContent = hexInCdata[0];
          console.log('通过CDATA找到加密内容，长度:', encryptedContent.length);
        }
      }
    }
    
    if (!encryptedContent) {
      console.log('未找到加密内容');
      return '';
    }
    
    console.log('加密内容前100字符:', encryptedContent.substring(0, 100));
    
    // 解密歌词
    try {
      const decryptedText = decryptQrcLyrics(encryptedContent);
      console.log('解密成功，解密文本长度:', decryptedText.length);
      
      if (!decryptedText || decryptedText.trim().length === 0) {
        console.log('解密文本为空');
        return '';
      }
      
      // 如果解密文本包含XML，尝试提取LyricContent
      let finalLyrics = decryptedText;
      if (decryptedText.includes('<?xml') || decryptedText.includes('<Lyric_1')) {
        console.log('解密文本包含XML结构，尝试解析');
        const lyricContent = extractLyricContentFromXml(decryptedText);
        if (lyricContent && lyricContent.trim().length > 0) {
          console.log('从XML中提取到歌词内容，长度:', lyricContent.length);
          finalLyrics = lyricContent;
        }
      }
      
      console.log('最终逐字歌词长度:', finalLyrics.length);
      console.log('逐字歌词前200字符:', finalLyrics.substring(0, Math.min(200, finalLyrics.length)));
      
      return finalLyrics;
      
    } catch (decryptError) {
      console.error('解密失败:', decryptError.message);
      return '';
    }
    
  } catch (error) {
    console.error('获取逐字歌词失败:', error.message);
    return '';
  }
}

// 解密QRC歌词
function decryptQrcLyrics(encryptedLyrics) {
  try {
    console.log('=== 开始解密QRC歌词 ===');
    console.log('输入长度:', encryptedLyrics.length);
    
    // 验证十六进制字符串
    if (!/^[0-9A-Fa-f]+$/.test(encryptedLyrics)) {
      console.error('不是有效的十六进制字符串');
      throw new Error('Invalid hex string');
    }
    
    // 确保长度为偶数
    if (encryptedLyrics.length % 2 !== 0) {
      console.warn('十六进制字符串长度为奇数，进行修正');
      encryptedLyrics = '0' + encryptedLyrics;
    }
    
    // 转换为字节数组
    const encryptedBytes = hexStringToByteArray(encryptedLyrics);
    console.log('加密字节长度:', encryptedBytes.length);
    
    // 使用3DES解密
    const key = '!@#)(*$%123ZXC!@!@#)(NHL';
    console.log('密钥:', key);
    console.log('密钥长度:', key.length);
    
    const crypto = require('crypto');
    const keyBuffer = Buffer.from(key, 'ascii');
    
    // 检查密钥长度
    if (keyBuffer.length !== 24) {
      console.warn('密钥长度不是24字节，可能有问题');
    }
    
    // 使用3DES ECB模式解密
    const decipher = crypto.createDecipheriv('des-ede3', keyBuffer, Buffer.alloc(0));
    decipher.setAutoPadding(false); // C#代码中没有使用标准填充
    
    // 解密
    let decrypted;
    try {
      decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedBytes)),
        decipher.final()
      ]);
    } catch (paddingError) {
      console.warn('标准解密失败，尝试无填充解密:', paddingError.message);
      // 尝试手动处理填充
      const decipher2 = crypto.createDecipheriv('des-ede3', keyBuffer, Buffer.alloc(0));
      decipher2.setAutoPadding(false);
      decrypted = decipher2.update(Buffer.from(encryptedBytes));
    }
    
    console.log('解密后字节长度:', decrypted.length);
    
    // 解压缩
    const decompressed = zlibInflate(new Uint8Array(decrypted));
    console.log('解压缩后长度:', decompressed.length);
    
    // 移除UTF-8 BOM
    const utf8Bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let resultBytes = decompressed;
    
    if (resultBytes.length >= 3 &&
        resultBytes[0] === utf8Bom[0] &&
        resultBytes[1] === utf8Bom[1] &&
        resultBytes[2] === utf8Bom[2]) {
      console.log('检测到BOM，已移除');
      resultBytes = resultBytes.slice(3);
    }
    
    // 转换为UTF-8字符串
    const result = new TextDecoder('utf-8').decode(resultBytes);
    console.log('解密结果长度:', result.length);
    
    if (result.length > 0) {
      console.log('解密结果前200字符:', result.substring(0, Math.min(200, result.length)));
    }
    
    return result;
    
  } catch (error) {
    console.error('解密过程失败:', error.message);
    throw error;
  }
}

// 十六进制字符串转字节数组
function hexStringToByteArray(hexString) {
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < hexString.length; i += 2) {
    bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
  }
  return bytes;
}

// zlib解压缩
function zlibInflate(compressedBytes) {
  try {
    const zlib = require('zlib');
    
    // 尝试inflateRaw（无zlib头）
    try {
      const decompressed = zlib.inflateRawSync(Buffer.from(compressedBytes));
      console.log('使用inflateRaw解压缩成功');
      return new Uint8Array(decompressed);
    } catch (error1) {
      console.warn('inflateRaw失败，尝试inflate:', error1.message);
      
      // 尝试inflate（带zlib头）
      try {
        const decompressed = zlib.inflateSync(Buffer.from(compressedBytes));
        console.log('使用inflate解压缩成功');
        return new Uint8Array(decompressed);
      } catch (error2) {
        console.warn('inflate失败，返回原始数据:', error2.message);
        return compressedBytes;
      }
    }
  } catch (error) {
    console.error('解压缩失败:', error.message);
    return compressedBytes;
  }
}

// 从XML提取歌词内容
function extractLyricContentFromXml(xmlText) {
  try {
    // 尝试匹配LyricContent属性
    const attrMatch = xmlText.match(/LyricContent="([^"]+)"/);
    if (attrMatch && attrMatch[1]) {
      return decodeHtmlEntities(attrMatch[1]);
    }
    
    // 尝试匹配<Lyric_1>标签内容
    const tagMatch = xmlText.match(/<Lyric_1[^>]*>([\s\S]*?)<\/Lyric_1>/);
    if (tagMatch && tagMatch[1]) {
      return decodeHtmlEntities(tagMatch[1]);
    }
    
    // 尝试匹配<lyric>标签内容
    const lyricMatch = xmlText.match(/<lyric[^>]*>([\s\S]*?)<\/lyric>/);
    if (lyricMatch && lyricMatch[1]) {
      return decodeHtmlEntities(lyricMatch[1]);
    }
    
    return xmlText;
  } catch (error) {
    console.error('提取歌词内容失败:', error.message);
    return xmlText;
  }
}

// 解码HTML实体
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };
  
  return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, match => entities[match]);
}

// ================ 原有辅助函数（保持不变） ================

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
      headers: {
        'Referer': 'https://c.y.qq.com/'
      }
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

async function searchSong(trackName, artists, originalTrackName, originalArtistName) {
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  if (shouldSimplify) {
    console.log('使用简化搜索');
    return await simplifiedSearch(trackName, artists, originalTrackName, originalArtistName);
  }
  
  for (const artist of artists) {
    try {
      const searchData = {
        req_1: {
          method: "DoSearchForQQMusicDesktop",
          module: "music.search.SearchCgiService",
          param: {
            num_per_page: 3,
            page_num: 1,
            query: trackName + ' ' + artist,
            search_type: 0
          }
        }
      };
      
      const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', searchData, {
        headers: {
          'Referer': 'https://c.y.qq.com/',
          'Content-Type': 'application/json'
        }
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
    id: song.id,
    mid: song.mid,
    name: song.name,
    title: song.name,
    singer: song.singer,
    album: song.album,
    interval: song.interval,
    songname: song.name
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
            param: {
              num_per_page: "3",
              page_num: "1",
              query: keyword,
              search_type: 0
            }
          }
        };
        
        const response = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', searchData, {
          headers: {
            'Referer': 'https://c.y.qq.com/',
            'Content-Type': 'application/json'
          }
        });
        
        const data = response.data;
        
        if (data?.req_1?.data?.body?.song?.list?.length > 0) {
          const songs = transformSearchResults(data.req_1.data.body.song.list);
          const match = findBestMatch(songs, trackName, artists, originalTrackName, originalArtistName);
          if (match) {
            return match;
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.warn(`策略${i+1}失败:`, error.message);
    }
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
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
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

function getSongName(song) {
  return song.song || song.name || song.songname || song.title || song.songName;
}

function extractArtists(song) {
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

function extractAlbumName(song) {
  if (!song.album) return '';
  if (typeof song.album === 'object') return song.album.name || song.album.title || '';
  return String(song.album);
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

// 获取普通歌词
async function getLyrics(songMid) {
  try {
    const currentMillis = Date.now();
    const callback = 'MusicJsonCallback_lrc';
    
    const params = new URLSearchParams({
      callback: callback,
      pcachetime: currentMillis.toString(),
      songmid: songMid,
      g_tk: '5381',
      jsonpCallback: callback,
      loginUin: '0',
      hostUin: '0',
      format: 'jsonp',
      inCharset: 'utf8',
      outCharset: 'utf8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0'
    });
    
    const response = await axios.get(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`, {
      headers: {
        'Referer': 'https://c.y.qq.com/'
      }
    });
    
    let data = response.data;
    
    // 处理JSONP响应
    if (data.startsWith(callback)) {
      data = data.replace(callback + '(', '').slice(0, -1);
    }
    
    const lyricData = JSON.parse(data);
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let translatedLyrics = '';
    
    if (lyricData.lyric) {
      const decodedLyric = Buffer.from(lyricData.lyric, 'base64').toString('utf-8');
      syncedLyrics = filterLyricsWithNewRules(decodedLyric);
      plainLyrics = '';
    }
    
    if (lyricData.trans) {
      const decodedTrans = Buffer.from(lyricData.trans, 'base64').toString('utf-8');
      translatedLyrics = filterLyricsWithNewRules(decodedTrans);
    }
    
    return { syncedLyrics, plainLyrics, translatedLyrics };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return { 
      syncedLyrics: '', 
      plainLyrics: '', 
      translatedLyrics: ''
    };
  }
}

function filterLyricsWithNewRules(lyricContent) {
  if (!lyricContent) return '';
  
  const lines = lyricContent.replace(/\r\n/g, '\n').split('\n');
  
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    return !(/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed));
  });
  
  const parsedLines = [];
  for (const line of filteredLines) {
    const match = line.match(/^(\[[0-9:.]+\])(.*)$/);
    if (match) {
      parsedLines.push({
        raw: line,
        timestamp: match[1],
        text: match[2].trim(),
        plainText: match[2].trim().replace(/\[.*?\]/g, '')
      });
    }
  }
  
  let filtered = [...parsedLines];
  let removedColonPlainTexts = [];
  
  // 标题行处理
  let i = 0;
  let scanLimit = Math.min(3, filtered.length);
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    if (text.includes('-')) {
      filtered.splice(i, 1);
      scanLimit = Math.min(3, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  // 冒号行处理
  let removedA2Colon = false;
  i = 0;
  scanLimit = Math.min(3, filtered.length);
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    if (containsColon(text)) {
      removedColonPlainTexts.push(text);
      filtered.splice(i, 1);
      removedA2Colon = true;
      scanLimit = Math.min(3, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  // 开头连续冒号行
  let leading = 0;
  while (leading < filtered.length) {
    const text = filtered[leading].plainText;
    if (containsColon(text)) {
      leading += 1;
    } else {
      break;
    }
  }
  
  if (removedA2Colon) {
    if (leading >= 1) {
      for (let idx = 0; idx < leading; idx++) {
        removedColonPlainTexts.push(filtered[idx].plainText);
      }
      filtered.splice(0, leading);
    }
  } else {
    if (leading >= 2) {
      for (let idx = 0; idx < leading; idx++) {
        removedColonPlainTexts.push(filtered[idx].plainText);
      }
      filtered.splice(0, leading);
    }
  }
  
  let newFiltered = [];
  i = 0;
  while (i < filtered.length) {
    const text = filtered[i].plainText;
    if (containsColon(text)) {
      let j = i;
      while (j < filtered.length) {
        const tj = filtered[j].plainText;
        if (containsColon(tj)) {
          j += 1;
        } else {
          break;
        }
      }
      const runLen = j - i;
      if (runLen >= 2) {
        for (let k = i; k < j; k++) {
          removedColonPlainTexts.push(filtered[k].plainText);
        }
        i = j;
      } else {
        newFiltered.push(filtered[i]);
        i = j;
      }
    } else {
      newFiltered.push(filtered[i]);
      i += 1;
    }
  }
  filtered = newFiltered;
  
  filtered = filtered.filter(line => !containsBracketTag(line.plainText));
  
  i = 0;
  scanLimit = Math.min(2, filtered.length);
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    if (containsParenPair(text)) {
      filtered.splice(i, 1);
      scanLimit = Math.min(2, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  filtered = filtered.filter(line => !isLicenseWarningLine(line.plainText));
  
  filtered = filtered.filter(line => {
    const text = line.plainText;
    
    if (text === '') return false;
    if (text === '//') return false;
    if (/^\/\/\s*$/.test(text) || /^\[\d+:\d+(\.\d+)?\]\s*\/\/\s*$/.test(line.raw)) {
      return false;
    }
    if (/^\[\d+:\d+(\.\d+)?\]\s*$/.test(line.raw)) {
      return false;
    }
    
    return true;
  });
  
  const result = filtered.map(line => line.raw).join('\n');
  return result;
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
