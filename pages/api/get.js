import axios from 'axios';

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
    
    // 搜索
    const song = await searchSong(processedTrackName, processedArtists, finalTrackName, finalArtistName);
    
    if (!song) {
      return res.status(404).json({ error: 'Song not found', message: '未找到匹配的歌曲' });
    }
    
    console.log('找到歌曲:', { name: getSongName(song), artist: extractArtists(song), id: song.id });
    
    // 获取歌词
    const lyrics = await getLyrics(song.id);
    
    // 返回结果
    const response = {
      id: song.id,
      name: getSongName(song) || finalTrackName,
      trackName: getSongName(song) || finalTrackName,
      artistName: extractArtists(song),
      albumName: extractAlbumName(song),
      duration: calculateDuration(song.interval),
      // 修复 instrumental 判断逻辑
      instrumental: (!lyrics.syncedLyrics || lyrics.syncedLyrics.trim() === '') && 
                    (!lyrics.translatedLyrics || lyrics.translatedLyrics.trim() === ''),
      plainLyrics: '', // 设置为空字符串，不移除该字段
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
    const lyrics = await getLyricsByMid(mappedMid);
    
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

// 通过MID获取歌词
async function getLyricsByMid(mid) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?mid=${mid}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let translatedLyrics = '';
    let yrcLyrics = '';
    
    if (data?.code === 200 && data.data) {
      // 使用新的过滤规则处理LRC歌词
      if (data.data.lrc) {
        syncedLyrics = filterLyricsWithNewRules(data.data.lrc);
        plainLyrics = '';
      }
      
      // 使用新的过滤规则处理翻译歌词
      if (data.data.trans) {
        translatedLyrics = filterLyricsWithNewRules(data.data.trans);
      }
      
      // 使用改进的YRC过滤，传入已过滤的LRC歌词
      if (data.data.yrc) {
        yrcLyrics = filterYrcLyrics(data.data.yrc, syncedLyrics);
      }
    }
    
    return { 
      syncedLyrics, 
      plainLyrics, 
      translatedLyrics,
      yrcLyrics
    };
    
  } catch (error) {
    console.error('通过MID获取歌词失败:', error);
    return { 
      syncedLyrics: '', 
      plainLyrics: '', 
      translatedLyrics: '',
      yrcLyrics: ''
    };
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

// 搜索歌曲
async function searchSong(trackName, artists, originalTrackName, originalArtistName) {
  // 判断是否需要简化搜索
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  if (shouldSimplify) {
    console.log('使用简化搜索');
    return await simplifiedSearch(trackName, artists, originalTrackName, originalArtistName);
  }
  
  // 正常搜索 - 限制返回3个结果
  for (const artist of artists) {
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(trackName + ' ' + artist)}&num=3`;
    
    try {
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        const match = findBestMatch(data.data, trackName, artists, originalTrackName, originalArtistName);
        if (match) return match;
      }
    } catch (error) {
      console.error('搜索失败:', error);
    }
  }
  
  return null;
}

// 简化搜索
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
        // 限制返回3个结果
        const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}&num=3`;
        
        const response = await axios.get(searchUrl);
        const data = response.data;
        
        if (data?.code === 200 && data.data?.length > 0) {
          const match = findBestMatch(data.data, trackName, artists, originalTrackName, originalArtistName);
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
  return japaneseOrChineseMatch ? japaneseOrChineseMatch[0] : text.split(/\s+/)[0];
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

// 获取歌词（使用新的过滤规则）
async function getLyrics(songId) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    let syncedLyrics = '';
    let plainLyrics = '';
    let translatedLyrics = '';
    let yrcLyrics = '';
    
    if (data?.code === 200 && data.data) {
      // 使用新的过滤规则处理LRC歌词
      if (data.data.lrc) {
        syncedLyrics = filterLyricsWithNewRules(data.data.lrc);
        plainLyrics = '';
      }
      
      // 使用新的过滤规则处理翻译歌词
      if (data.data.trans) {
        translatedLyrics = filterLyricsWithNewRules(data.data.trans);
      }
      
      // 使用改进的YRC过滤，传入已过滤的LRC歌词
      if (data.data.yrc) {
        yrcLyrics = filterYrcLyrics(data.data.yrc, syncedLyrics);
      }
    }
    
    return { 
      syncedLyrics, 
      plainLyrics, 
      translatedLyrics,
      yrcLyrics
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

// 改进的YRC歌词过滤函数 - 基于LRC歌词定位有效起始位置
function filterYrcLyrics(yrcContent, syncedLyrics) {
  if (!yrcContent) return '';
  
  // 如果LRC歌词为空，则使用备用过滤方案
  if (!syncedLyrics || syncedLyrics.trim() === '') {
    return filterYrcLyricsFallback(yrcContent);
  }
  
  // 1) 从LRC歌词中提取第一行有效歌词的时间戳
  const firstLrcTime = extractFirstLrcTimestamp(syncedLyrics);
  
  if (!firstLrcTime) {
    // 如果无法提取LRC时间戳，使用备用方案
    return filterYrcLyricsFallback(yrcContent);
  }
  
  console.log(`LRC第一行歌词时间: ${firstLrcTime}ms`);
  
  // 2) 将YRC歌词按行分割
  const lines = yrcContent.replace(/\r\n/g, '\n').split('\n');
  
  // 3) 移除元数据标签行
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    return !(/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed));
  });
  
  // 4) 解析YRC行并找到有效起始位置
  const parsedLines = [];
  let foundStart = false;
  
  for (const line of filteredLines) {
    const match = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (match) {
      const startTime = parseInt(match[1]);
      const duration = parseInt(match[2]);
      const content = match[3].trim();
      
      // 检查是否达到或超过LRC第一行的时间
      // 添加一些容差，因为YRC可能比LRC稍早开始
      if (!foundStart && startTime >= firstLrcTime - 2000) {
        foundStart = true;
        console.log(`找到YRC有效起始行: ${startTime}ms, 内容: ${extractPlainTextFromYrc(content).substring(0, 20)}...`);
      }
      
      if (foundStart) {
        parsedLines.push({
          raw: line,
          startTime,
          duration,
          content
        });
      }
    }
  }
  
  // 5) 如果没找到基于时间的起始点，使用备用方案
  if (parsedLines.length === 0) {
    console.log('基于时间的过滤失败，使用备用方案');
    return filterYrcLyricsFallback(yrcContent);
  }
  
  // 6) 对保留的行进行额外清理（移除可能的残留制作信息）
  const cleanedLines = parsedLines.filter(line => {
    const plainText = extractPlainTextFromYrc(line.content);
    
    // 移除空行
    if (plainText.trim() === '') return false;
    
    // 移除明显的制作人员行（即使它们在有效时间后）
    if (isProductionLine(plainText, line.startTime)) {
      return false;
    }
    
    // 移除版权警告行
    if (isLicenseWarningLine(plainText)) {
      return false;
    }
    
    // 移除包含标签的行
    if (containsBracketTag(plainText)) {
      return false;
    }
    
    return true;
  });
  
  // 重新组合成YRC格式
  const result = cleanedLines.map(line => line.raw).join('\n');
  
  console.log(`YRC过滤结果: 从${lines.length}行减少到${cleanedLines.length}行`);
  return result;
}

// 从LRC歌词中提取第一行有效歌词的时间戳（转换为毫秒）
function extractFirstLrcTimestamp(lrcContent) {
  if (!lrcContent) return null;
  
  const lines = lrcContent.split('\n');
  
  for (const line of lines) {
    const match = line.match(/^\[(\d+):(\d+)\.(\d+)\]/);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const hundredths = parseInt(match[3]);
      
      // 转换为毫秒
      return (minutes * 60 + seconds) * 1000 + hundredths * 10;
    }
  }
  
  return null;
}

// 判断是否为制作人员行
function isProductionLine(plainText, startTime) {
  // 制作人员关键词
  const productionKeywords = [
    '词', '曲', '编曲', '制作人', '合声', '合声编写', '吉他', '贝斯', '鼓',
    '录音助理', '录音工程', '混音工程', '录音', '混音', '工程', '助理', '编写',
    'lyrics', 'lyric', 'composed', 'compose', 'producer', 'produce', 'produced'
  ];
  
  // 检查是否包含制作关键词
  for (const keyword of productionKeywords) {
    if (plainText.includes(keyword)) {
      return true;
    }
  }
  
  // 检查是否包含冒号（制作人员信息常见格式）
  if (containsColon(plainText)) {
    return true;
  }
  
  return false;
}

// 备用过滤方案（当基于时间的过滤失败时使用）
function filterYrcLyricsFallback(yrcContent) {
  if (!yrcContent) return '';
  
  const lines = yrcContent.replace(/\r\n/g, '\n').split('\n');
  
  // 移除元数据标签行
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    return !(/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed));
  });
  
  // 解析并过滤
  const parsedLines = [];
  let foundLyricsStart = false;
  
  for (const line of filteredLines) {
    const match = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (match) {
      const startTime = parseInt(match[1]);
      const content = match[3].trim();
      const plainText = extractPlainTextFromYrc(content);
      
      // 跳过空行
      if (plainText.trim() === '') continue;
      
      // 跳过制作人员信息（通常在歌曲前30秒）
      if (startTime < 30000 && isProductionLine(plainText, startTime)) {
        continue;
      }
      
      // 一旦找到非制作人员的歌词内容，标记开始
      if (!foundLyricsStart && !isProductionLine(plainText, startTime)) {
        foundLyricsStart = true;
      }
      
      // 只有找到歌词开始后才添加行，或者如果是制作信息但时间靠后也添加
      if (foundLyricsStart || startTime >= 30000) {
        // 额外检查版权和标签
        if (!isLicenseWarningLine(plainText) && !containsBracketTag(plainText)) {
          parsedLines.push(line);
        }
      }
    }
  }
  
  return parsedLines.join('\n');
}

// 从YRC内容中提取纯文本（移除时间标记）
function extractPlainTextFromYrc(yrcContent) {
  if (!yrcContent) return '';
  
  let plainText = '';
  let currentPos = 0;
  
  while (currentPos < yrcContent.length) {
    const parenIndex = yrcContent.indexOf('(', currentPos);
    
    if (parenIndex === -1) {
      plainText += yrcContent.substring(currentPos);
      break;
    }
    
    plainText += yrcContent.substring(currentPos, parenIndex);
    
    const closeParenIndex = yrcContent.indexOf(')', parenIndex);
    if (closeParenIndex === -1) {
      break;
    }
    
    currentPos = closeParenIndex + 1;
  }
  
  return plainText.trim();
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

// 辅助函数 - 从被删除的冒号行中提取制作人员信息
function extractNamesFromRemovedColonLines(removedLines) {
  const creditKeywords = ['lyrics', 'lyric', 'composed', 'compose', 'producer', 'produce', 'produced', '词', '曲', '制作人'];
  const credits = [];
  
  for (const line of removedLines) {
    for (const keyword of creditKeywords) {
      if (line.toLowerCase().includes(keyword.toLowerCase())) {
        credits.push(line);
        break;
      }
    }
  }
  
  return credits;
}
