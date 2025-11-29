import axios from 'axios';
import pako from 'pako';
import CryptoJS from 'crypto-js';

// QQ音乐逐字歌词解密工具
class QrcDecoder {
  static QQKey = '!@#)(*$%123ZXC!@!@#)(NHL';
  
  /**
   * 解密 QRC 歌词
   */
  static decryptLyrics(encryptedLyrics) {
    try {
      if (!encryptedLyrics || encryptedLyrics.length === 0) {
        console.log('解密失败：加密内容为空');
        return null;
      }

      // 检查是否是有效的16进制字符串
      if (!/^[0-9A-Fa-f]+$/.test(encryptedLyrics)) {
        console.log('解密失败：不是有效的16进制字符串');
        return null;
      }

      // 16进制字符串转字节数组
      const encryptedBytes = this.hexToBytes(encryptedLyrics);
      console.log(`加密字节长度: ${encryptedBytes.length}`);
      
      // 使用 crypto-js 进行 3DES 解密
      const decrypted = this.tripleDesDecrypt(encryptedBytes);
      
      if (!decrypted || decrypted.length === 0) {
        console.log('解密失败：解密后内容为空');
        return null;
      }

      console.log(`解密后字节长度: ${decrypted.length}`);
      
      // 解压缩
      let decompressed;
      try {
        decompressed = pako.inflate(decrypted);
        console.log(`解压缩后字节长度: ${decompressed.length}`);
      } catch (inflateError) {
        console.log('解压缩失败，尝试直接使用解密内容:', inflateError.message);
        // 如果解压缩失败，可能内容没有被压缩，直接使用解密内容
        decompressed = decrypted;
      }
      
      // 转字符串
      const result = new TextDecoder().decode(decompressed);
      
      if (!result || result.trim().length === 0) {
        console.log('解密失败：转换字符串后内容为空');
        return null;
      }
      
      return result;
    } catch (error) {
      console.error('解密逐字歌词失败:', error);
      return null;
    }
  }
  
  /**
   * 16进制字符串转字节数组
   */
  static hexToBytes(hexString) {
    try {
      const bytes = new Uint8Array(hexString.length / 2);
      for (let i = 0; i < hexString.length; i += 2) {
        bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
      }
      return bytes;
    } catch (error) {
      console.error('16进制转换失败:', error);
      return new Uint8Array(0);
    }
  }
  
  /**
   * 3DES 解密
   */
  static tripleDesDecrypt(inputBytes) {
    try {
      // 将密钥字符串转换为 WordArray
      const key = CryptoJS.enc.Utf8.parse(this.QQKey);
      
      // 将输入字节数组转换为 WordArray
      const encryptedWordArray = CryptoJS.lib.WordArray.create(inputBytes);
      
      // 3DES 解密 - 使用 ECB 模式，无 IV
      const decrypted = CryptoJS.TripleDES.decrypt(
        {
          ciphertext: encryptedWordArray
        },
        key,
        {
          mode: CryptoJS.mode.ECB,
          padding: CryptoJS.pad.Pkcs7
        }
      );
      
      // 转换回 Uint8Array
      return CryptoJS.enc.Uint8Array.from(decrypted);
    } catch (error) {
      console.error('3DES 解密失败:', error);
      return null;
    }
  }
}

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
    console.log('搜索请求:', { 
      trackName: finalTrackName, 
      artistName: finalArtistName
    });
    
    // 预处理
    const processedTrackName = preprocessTrackName(finalTrackName);
    const processedArtists = preprocessArtists(finalArtistName);
    
    console.log('预处理结果:', {
      processedTrackName,
      processedArtists
    });
    
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
    
    console.log('找到歌曲详情:', { 
      name: getSongName(song), 
      artist: extractArtists(song), 
      id: song.id,
      mid: song.mid
    });
    
    // 获取歌词（包含逐字歌词）
    const lyrics = await getLyrics(song.mid || song.id);
    
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
      yrcLyrics: lyrics.yrcLyrics || '' // 新增逐字歌词字段
    };
    
    console.log('API响应完成，逐字歌词长度:', response.yrcLyrics.length);
    
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
    // 直接使用映射的MID获取歌词
    const lyrics = await getLyrics(mappedMid);
    
    // 尝试获取歌曲信息
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
      yrcLyrics: lyrics.yrcLyrics || '', // 新增逐字歌词字段
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

// 通过MID获取歌曲信息
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

// 预处理艺术家
function preprocessArtists(artistName) {
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  return [...new Set(artists.filter(artist => artist.trim()))];
}

// 预处理歌名
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

// 使用官方API搜索歌曲
async function searchSong(trackName, artists, originalTrackName, originalArtistName) {
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  if (shouldSimplify) {
    console.log('使用简化搜索');
    return await simplifiedSearch(trackName, artists, originalTrackName, originalArtistName);
  }
  
  // 使用官方API搜索 - 限制返回3个结果
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

// 转换官方API搜索结果格式
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

// 简化搜索 - 使用官方API
async function simplifiedSearch(trackName, artists, originalTrackName, originalArtistName) {
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
      console.warn(`策略${i+1} 失败:`, error.message);
    }
  }
  
  return null;
}

// 提取核心歌名
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

// 查找最佳匹配
function findBestMatch(results, targetTrack, artists, originalTrackName, originalArtistName) {
  // 先尝试精确匹配（歌曲名和艺术家都匹配）
  const exactMatch = findExactMatch(results, originalTrackName, originalArtistName);
  if (exactMatch) return exactMatch;
  
  // 使用更智能的评分系统
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

// 精确匹配 - 要求歌曲名和艺术家都匹配
function findExactMatch(results, originalTrackName, originalArtistName) {
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
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

// 更智能的评分系统
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
  
  // 计算歌曲名匹配分数 - 更智能的匹配
  if (songTitle === originalTrackNameLower) {
    titleScore = 100; // 完全匹配原始歌名 - 最高分
  } else if (songTitle === targetTrackLower) {
    titleScore = 90; // 完全匹配预处理歌名
  } else if (isCloseMatch(songTitle, originalTrackNameLower)) {
    titleScore = 80; // 接近匹配原始歌名
  } else if (isCloseMatch(songTitle, targetTrackLower)) {
    titleScore = 70; // 接近匹配预处理歌名
  } else if (songTitle.includes(originalTrackNameLower) && originalTrackNameLower.length > 3) {
    titleScore = 60; // 包含原始歌名
  } else if (originalTrackNameLower.includes(songTitle) && songTitle.length > 3) {
    titleScore = 50; // 被原始歌名包含
  } else if (songTitle.includes(targetTrackLower) && targetTrackLower.length > 3) {
    titleScore = 40; // 包含预处理歌名
  } else if (targetTrackLower.includes(songTitle) && songTitle.length > 3) {
    titleScore = 30; // 被预处理歌名包含
  }
  
  // 计算艺术家匹配分数
  const songArtistsArray = songArtists.split(/\s*,\s*|\s+&\s+/);
  
  for (const targetArtist of artists) {
    const targetArtistLower = targetArtist.toLowerCase();
    
    for (const songArtist of songArtistsArray) {
      if (songArtist === originalArtistNameLower) {
        artistScore = Math.max(artistScore, 100); // 完全匹配原始艺术家名
        break;
      } else if (songArtist === targetArtistLower) {
        artistScore = Math.max(artistScore, 80); // 完全匹配预处理艺术家名
        break;
      } else if (songArtist.includes(originalArtistNameLower) || originalArtistNameLower.includes(songArtist)) {
        artistScore = Math.max(artistScore, 60); // 部分匹配原始艺术家名
        break;
      } else if (songArtist.includes(targetArtistLower) || targetArtistLower.includes(songArtist)) {
        artistScore = Math.max(artistScore, 40); // 部分匹配预处理艺术家名
        break;
      }
    }
  }
  
  // 计算综合分数 - 使用动态权重
  let titleWeight = 0.6;
  let artistWeight = 0.4;
  
  // 如果艺术家完全匹配但歌曲名部分匹配，增加艺术家权重
  if (artistScore >= 80 && titleScore >= 40) {
    titleWeight = 0.4;
    artistWeight = 0.6;
  }
  
  // 如果歌曲名完全匹配但艺术家部分匹配，增加歌曲名权重
  if (titleScore >= 90 && artistScore >= 40) {
    titleWeight = 0.8;
    artistWeight = 0.2;
  }
  
  let totalScore = (titleScore * titleWeight) + (artistScore * artistWeight);
  
  // 特殊情况处理
  // 如果歌曲名完全匹配原始歌名，给予最高优先级
  if (songTitle === originalTrackNameLower) {
    totalScore = Math.max(totalScore, 95);
  }
  
  // 如果歌曲名和艺术家都匹配得很好，给予额外奖励
  if (titleScore >= 70 && artistScore >= 80) {
    totalScore += 15;
  }
  
  // 如果艺术家完全匹配但歌曲名部分匹配，给予中等奖励
  if (artistScore === 100 && titleScore >= 40) {
    totalScore += 10;
  }
  
  return totalScore;
}

// 判断是否为接近匹配
function isCloseMatch(songTitle, targetTitle) {
  // 移除常见修饰词
  const cleanSong = songTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  const cleanTarget = targetTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  
  // 如果清理后相同，则是接近匹配
  if (cleanSong === cleanTarget) {
    return true;
  }
  
  // 如果是日文/中文歌曲，检查是否包含核心部分
  const hasJapaneseOrChinese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(targetTitle);
  if (hasJapaneseOrChinese) {
    const corePart = extractCorePart(targetTitle);
    if (songTitle.includes(corePart)) {
      return true;
    }
  }
  
  return false;
}

// 提取核心部分（日文/中文）
function extractCorePart(text) {
  const japaneseOrChineseMatch = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  return japaneseOrChineseMatch ? japaneseOrChineseMatch[0] : text.split(/\s+/)[0] || text;
}

// 获取歌曲名称
function getSongName(song) {
  return song.song || song.name || song.songname || song.title || song.songName;
}

// 提取歌手信息
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

// 提取专辑信息
function extractAlbumName(song) {
  if (!song.album) return '';
  if (typeof song.album === 'object') return song.album.name || song.album.title || '';
  return String(song.album);
}

// 计算时长
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

// 获取歌词（包含逐字歌词）
async function getLyrics(songMid) {
  try {
    console.log(`开始获取歌词，歌曲MID: ${songMid}`);
    
    // 首先获取普通歌词（保持原有逻辑）
    const standardLyrics = await getStandardLyrics(songMid);
    
    // 然后获取逐字歌词
    const yrcLyrics = await getYrcLyrics(songMid);
    
    // 合并结果
    return {
      ...standardLyrics,
      yrcLyrics: yrcLyrics || ''
    };
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return { 
      syncedLyrics: '', 
      plainLyrics: '', 
      translatedLyrics: '',
      yrcLyrics: ''
    };
  }
}

// 原有的普通歌词获取函数（重命名）
async function getStandardLyrics(songMid) {
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
      outCharset: 'utf-8',
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
      // 解码Base64歌词
      const decodedLyric = Buffer.from(lyricData.lyric, 'base64').toString('utf-8');
      // 解码HTML实体
      const decodedWithEntities = decodeHtmlEntities(decodedLyric);
      syncedLyrics = filterLyricsWithNewRules(decodedWithEntities);
      plainLyrics = '';
    }
    
    if (lyricData.trans) {
      // 解码Base64翻译歌词
      const decodedTrans = Buffer.from(lyricData.trans, 'base64').toString('utf-8');
      // 解码HTML实体
      const decodedTransWithEntities = decodeHtmlEntities(decodedTrans);
      translatedLyrics = filterLyricsWithNewRules(decodedTransWithEntities);
    }
    
    return { syncedLyrics, plainLyrics, translatedLyrics };
    
  } catch (error) {
    console.error('获取普通歌词失败:', error);
    return { 
      syncedLyrics: '', 
      plainLyrics: '', 
      translatedLyrics: ''
    };
  }
}

// 新增：获取逐字歌词
async function getYrcLyrics(songMid) {
  try {
    console.log(`开始获取逐字歌词，歌曲MID: ${songMid}`);
    
    const params = new URLSearchParams({
      version: '15',
      miniversion: '82',
      lrctype: '4', // QRC 格式
      musicid: songMid
    });
    
    const response = await axios.post(
      'https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg',
      params,
      {
        headers: {
          'Referer': 'https://c.y.qq.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 8000 // 8秒超时
      }
    );
    
    // 清理响应数据
    let data = response.data.replace(/<!--|-->/g, '');
    console.log('逐字歌词接口原始响应:', data.substring(0, 500)); // 只打印前500字符用于调试
    
    // 使用正则表达式提取加密的歌词内容 - 尝试多种可能的标签
    let encryptedContent = null;
    
    // 尝试 <content> 标签
    const contentMatch = data.match(/<content>([^<]+)<\/content>/);
    if (contentMatch) {
      encryptedContent = contentMatch[1];
      console.log('从<content>标签找到加密内容，长度:', encryptedContent.length);
    }
    
    // 如果没找到，尝试 <contentts> 标签（翻译内容）
    if (!encryptedContent) {
      const contentTsMatch = data.match(/<contentts>([^<]+)<\/contentts>/);
      if (contentTsMatch) {
        encryptedContent = contentTsMatch[1];
        console.log('从<contentts>标签找到加密内容，长度:', encryptedContent.length);
      }
    }
    
    // 如果还是没找到，尝试 <contentroma> 标签（罗马音）
    if (!encryptedContent) {
      const contentRomaMatch = data.match(/<contentroma>([^<]+)<\/contentroma>/);
      if (contentRomaMatch) {
        encryptedContent = contentRomaMatch[1];
        console.log('从<contentroma>标签找到加密内容，长度:', encryptedContent.length);
      }
    }
    
    if (!encryptedContent) {
      console.log('未找到任何加密的歌词内容');
      console.log('响应中包含的标签:', data.match(/<(\w+)>/g)?.slice(0, 10) || '无标签');
      return null;
    }
    
    console.log('加密内容前100字符:', encryptedContent.substring(0, 100));
    
    // 解密逐字歌词
    const decrypted = QrcDecoder.decryptLyrics(encryptedContent);
    if (!decrypted) {
      console.log('解密失败，返回null');
      return null;
    }
    
    console.log('解密成功，内容长度:', decrypted.length);
    console.log('解密内容前200字符:', decrypted.substring(0, 200));
    
    // 解析解密后的内容
    const result = parseDecryptedYrc(decrypted);
    console.log('解析后的逐字歌词长度:', result?.length || 0);
    
    return result;
    
  } catch (error) {
    console.error('获取逐字歌词失败:', error.message);
    return null;
  }
}

// 解析解密后的逐字歌词
function parseDecryptedYrc(decryptedContent) {
  try {
    console.log('开始解析解密内容，类型:', typeof decryptedContent);
    
    if (!decryptedContent) {
      console.log('解析失败：解密内容为空');
      return null;
    }

    // 如果是 XML 格式，提取歌词内容
    if (decryptedContent.includes('<QrcLyric>') || decryptedContent.includes('<Lyric_')) {
      console.log('检测到XML格式内容');
      
      // 提取 LyricContent 属性
      const lyricMatch = decryptedContent.match(/LyricContent="([^"]*)"/);
      if (lyricMatch && lyricMatch[1]) {
        console.log('从LyricContent属性提取到内容');
        return lyricMatch[1];
      }
      
      // 尝试 CDATA 内容
      const cdataMatch = decryptedContent.match(/<!\[CDATA\[(.*?)\]\]>/s);
      if (cdataMatch && cdataMatch[1]) {
        console.log('从CDATA提取到内容');
        return cdataMatch[1];
      }
      
      // 尝试直接提取标签内容
      const directMatch = decryptedContent.match(/<content>([^<]+)<\/content>/);
      if (directMatch && directMatch[1]) {
        console.log('从<content>标签提取到内容');
        return directMatch[1];
      }
      
      console.log('XML解析失败，返回原始内容');
      return decryptedContent;
    }
    
    // 检查是否是纯文本的逐字歌词格式（包含时间轴）
    if (decryptedContent.includes('[') && decryptedContent.includes(']')) {
      console.log('检测到可能的时间轴格式');
      // 可能是直接的逐字歌词格式，直接返回
      return decryptedContent;
    }
    
    console.log('无法识别的内容格式，返回原始内容');
    return decryptedContent;
  } catch (error) {
    console.error('解析逐字歌词失败:', error);
    return decryptedContent; // 返回原始内容
  }
}

// HTML实体解码函数
function decodeHtmlEntities(text) {
  if (!text) return '';
  
  const entities = {
    '&apos;': "'",
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#39;': "'",
    '&#34;': '"',
    '&#38;': '&',
    '&#60;': '<',
    '&#62;': '>',
    '&nbsp;': ' ',
    '&ensp;': ' ',
    '&emsp;': ' '
  };
  
  return text.replace(/&(apos|quot|amp|lt|gt|#39|#34|#38|#60|#62|nbsp|ensp|emsp);/g, 
    match => entities[match] || match);
}

// 使用新的过滤规则处理歌词
function filterLyricsWithNewRules(lyricContent) {
  if (!lyricContent) return '';
  
  // 1) 将歌词按行分割，处理 Windows 换行符 \r\n
  const lines = lyricContent.replace(/\r\n/g, '\n').split('\n');
  
  // 首先移除所有的标签行（[ti:], [ar:], [al:], [by:], [offset:] 等）
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    // 移除所有标签行，但保留有时间轴的歌词行
    return !(/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed));
  });
  
  // 解析每行，提取时间戳和文本内容
  const parsedLines = [];
  for (const line of filteredLines) {
    const match = line.match(/^(\[[0-9:.]+\])(.*)$/);
    if (match) {
      parsedLines.push({
        raw: line,
        timestamp: match[1],
        text: match[2].trim(),
        plainText: match[2].trim().replace(/\[.*?\]/g, '') // 移除内嵌标签的纯文本
      });
    }
  }
  
  // 2) 基础序列 - 按时间戳排序
  let filtered = [...parsedLines];
  
  // 收集"被删除的冒号行"的纯文本
  let removedColonPlainTexts = [];
  
  // 2) A) 标题行（仅前三行内；含 '-' 就删）
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
  
  // 2.5) A2) 前三行内：含冒号的行直接删除
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
  
  // 3) B0) 处理"开头连续冒号行"
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
  
  // 3) 制作行（全局）：删除任意位置出现的"连续 ≥2 行均含冒号"的区间
  let newFiltered = [];
  i = 0;
  while (i < filtered.length) {
    const text = filtered[i].plainText;
    if (containsColon(text)) {
      // 统计这一段连续"含冒号"的长度
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
        // 收集整段 i..<(i+runLen) 的纯文本后丢弃
        for (let k = i; k < j; k++) {
          removedColonPlainTexts.push(filtered[k].plainText);
        }
        i = j;
      } else {
        // 仅 1 行，保留
        newFiltered.push(filtered[i]);
        i = j;
      }
    } else {
      newFiltered.push(filtered[i]);
      i += 1;
    }
  }
  filtered = newFiltered;
  
  // 4) C) 全局删除：凡包含【】或 [] 的行一律删除
  filtered = filtered.filter(line => !containsBracketTag(line.plainText));
  
  // 4.5) C2) 处理开头两行的"圆括号标签"
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
  
  // 4.75) D) 全局删除：版权/授权/禁止类提示语
  filtered = filtered.filter(line => !isLicenseWarningLine(line.plainText));
  
  // 5) 额外的清理步骤：移除空时间轴行和只有"//"的行
  filtered = filtered.filter(line => {
    const text = line.plainText;
    
    // 移除空行
    if (text === '') return false;
    
    // 移除只包含"//"的行
    if (text === '//') return false;
    
    // 移除只包含时间轴后面只有"//"的行（如 [00:36.66]//）
    if (/^\/\/\s*$/.test(text) || /^\[\d+:\d+(\.\d+)?\]\s*\/\/\s*$/.test(line.raw)) {
      return false;
    }
    
    // 移除只有时间轴的空行（如 [00:23.53]）
    if (/^\[\d+:\d+(\.\d+)?\]\s*$/.test(line.raw)) {
      return false;
    }
    
    return true;
  });
  
  // 重新组合成LRC格式
  const result = filtered.map(line => line.raw).join('\n');
  
  return result;
}

// 辅助函数 - 检查是否包含冒号（中英文冒号）
function containsColon(text) {
  return text.includes(':') || text.includes('：');
}

// 辅助函数 - 检查是否包含括号标签
function containsBracketTag(text) {
  const hasHalfPair = text.includes('[') && text.includes(']');
  const hasFullPair = text.includes('【') && text.includes('】');
  return hasHalfPair || hasFullPair;
}

// 辅助函数 - 检查是否包含圆括号对
function containsParenPair(text) {
  const hasHalfPair = text.includes('(') && text.includes(')');
  const hasFullPair = text.includes('（') && text.includes('）');
  return hasHalfPair || hasFullPair;
}

// 辅助函数 - 检查是否是版权警告行
function isLicenseWarningLine(text) {
  if (!text) return false;
  
  // 特殊关键词 - 只要包含这些词就直接认为是版权行
  const specialKeywords = ['文曲大模型', '享有本翻译作品的著作权'];
  for (const keyword of specialKeywords) {
    if (text.includes(keyword)) return true;
  }
  
  // 普通关键词 - 需要命中多个才认为是版权行
  const tokens = ['未经', '许可', '授权', '不得', '请勿', '使用', '版权', '翻唱'];
  let count = 0;
  for (const token of tokens) {
    if (text.includes(token)) count += 1;
  }
  return count >= 3; // 降低阈值到3
}
