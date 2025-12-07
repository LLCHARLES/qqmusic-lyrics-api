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
    
    // 检查是否需要直接映射到特定MID
    const mappedMid = checkSongMapping(finalTrackName, finalArtistName);
    if (mappedMid) {
      console.log(`检测到映射歌曲，直接使用MID: ${mappedMid}`);
      return await handleMappedSong(mappedMid, finalTrackName, finalArtistName, res);
    }
    
    // 预处理
    const processedTrackName = preprocessTrackName(finalTrackName);
    
    console.log('正常搜索:', processedTrackName);
    
    // 搜索
    const song = await searchSong(processedTrackName, finalArtistName, finalTrackName, finalArtistName);
    
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
function checkSongMapping(originalTrackName, originalArtistName) {
  const key = `${originalTrackName}_${originalArtistName}`;
  if (songMapping[key]) {
    return songMapping[key];
  }
  return null;
}

// 处理映射歌曲
async function handleMappedSong(mappedMid, originalTrackName, originalArtistName, res) {
  try {
    // 首先，通过MID获取歌词
    const lyrics = await getLyricsByMid(mappedMid);
    
    // 然后，尝试通过搜索API获取歌曲信息
    let songInfo = null;
    try {
      songInfo = await searchSongByMapping(originalTrackName, originalArtistName);
      
      // 如果搜索到的歌曲MID与映射MID不一致，使用映射MID
      if (songInfo && songInfo.mid !== mappedMid) {
        console.log('搜索到的MID与映射MID不一致，使用映射MID:', { 搜索MID: songInfo.mid, 映射MID: mappedMid });
        // 我们仍然使用映射MID，但保留搜索结果中的歌曲信息
        songInfo.mid = mappedMid;
        songInfo.id = mappedMid;
      }
    } catch (error) {
      console.log('无法通过搜索API获取歌曲信息，使用默认信息');
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

// 通过映射表的歌名艺人搜索歌曲信息
async function searchSongByMapping(trackName, artistName) {
  // 使用原始歌名和艺人名搜索
  const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(trackName + ' ' + artistName)}`;
  
  const response = await axios.get(searchUrl);
  const data = response.data;
  
  if (data?.code === 200 && data.data?.length > 0) {
    return data.data[0]; // 返回第一个结果
  }
  
  throw new Error('无法通过搜索API获取歌曲信息');
}

// 通过MID获取歌词
async function getLyricsByMid(mid) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?mid=${mid}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    return processLyricsData(data);
    
  } catch (error) {
    console.error('通过MID获取歌词失败:', error);
    return getEmptyLyrics();
  }
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

// 搜索歌曲 - 简化版本，专注于匹配算法
async function searchSong(trackName, artistName, originalTrackName, originalArtistName) {
  console.log(`搜索歌曲: "${originalTrackName}" by "${originalArtistName}"`);
  
  // 尝试多种搜索组合
  const searchCombinations = [
    `${originalTrackName} ${originalArtistName}`,  // 原始歌名+原始艺术家
    `${trackName} ${artistName}`,                  // 预处理歌名+艺术家
    `${originalTrackName}`,                        // 仅原始歌名
    `${trackName}`,                                // 仅预处理歌名
  ];
  
  for (const keyword of searchCombinations) {
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}`;
    console.log(`搜索尝试: "${keyword}"`);
    
    try {
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      if (data?.code === 200 && data.data?.length > 0) {
        console.log(`搜索成功，找到 ${data.data.length} 个结果`);
        
        // 使用匹配算法找到最佳结果
        const match = findBestMatch(data.data, trackName, artistName, originalTrackName, originalArtistName);
        if (match) {
          return match;
        }
      }
    } catch (error) {
      console.error('搜索失败:', error.message);
    }
    
    // 短暂延迟避免请求过快
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('所有搜索组合均未找到匹配结果');
  return null;
}

// 查找最佳匹配
function findBestMatch(results, targetTrack, artistName, originalTrackName, originalArtistName) {
  console.log(`findBestMatch: 原始搜索 - "${originalTrackName}" by "${originalArtistName}"`);
  console.log(`结果数量: ${results.length}`);
  
  // 先尝试精确匹配（歌曲名和艺术家都匹配）
  const exactMatch = findExactMatch(results, originalTrackName, originalArtistName);
  if (exactMatch) {
    console.log('找到精确匹配');
    return exactMatch;
  }
  
  // 使用更智能的评分系统
  let bestMatch = null;
  let bestScore = 0;
  let allScores = [];
  
  for (const song of results) {
    const score = calculateSmartScore(song, targetTrack, artistName, originalTrackName, originalArtistName);
    allScores.push({
      name: getSongName(song),
      artist: extractArtists(song),
      score: score,
      isLive: /(现场|live|音乐会|音乐节)/i.test(getSongName(song)),
      hasParentheses: /\(.*\)/.test(getSongName(song))
    });
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
    }
  }
  
  // 按分数排序并输出调试信息
  allScores.sort((a, b) => b.score - a.score);
  console.log('匹配分数排序:');
  allScores.slice(0, Math.min(5, allScores.length)).forEach((item, i) => {
    console.log(`${i+1}. "${item.name}" - ${item.artist} (分数: ${item.score}) ${item.isLive ? '[LIVE]' : ''} ${item.hasParentheses ? '[括号]' : ''}`);
  });
  
  if (bestMatch) {
    console.log(`选择最佳匹配: "${getSongName(bestMatch)}" - ${extractArtists(bestMatch)} (分数: ${bestScore})`);
  } else if (results.length > 0) {
    console.log('没有找到最佳匹配，使用第一个结果');
    bestMatch = results[0];
  }
  
  return bestMatch;
}

// 增强的精确匹配
function findExactMatch(results, originalTrackName, originalArtistName) {
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  // 首先尝试匹配没有括号的版本
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    if (songName && songArtists) {
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      // 1. 完全精确匹配（歌名和艺术家都完全匹配）且没有括号
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
        if (!songName.includes('(') && !songName.includes('（')) {
          console.log('精确匹配: 歌名和艺术家完全匹配，且没有括号');
          return song;
        }
      }
      
      // 2. 歌名完全匹配（没有括号版本），艺术家包含关系
      const songNameWithoutParentheses = songName.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (songNameWithoutParentheses.toLowerCase() === trackLower) {
        const songArtistArray = songArtistsLower.split(/\s*\/\s*|\s*,\s*|\s+&\s+/);
        if (songArtistArray.includes(artistLower)) {
          console.log('精确匹配: 核心歌名匹配，艺术家包含');
          return song;
        }
      }
    }
  }
  
  // 如果没有找到没有括号的版本，再尝试有括号的版本
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    if (songName && songArtists) {
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      // 完全精确匹配（包括有括号的情况）
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
        console.log('精确匹配: 歌名和艺术家完全匹配（有括号）');
        return song;
      }
    }
  }
  
  return null;
}

// 提取核心歌名（去掉括号和现场标记）
function extractCoreSongName(songName) {
  if (!songName) return '';
  
  let result = songName;
  
  // 移除括号及其内容
  result = result.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  
  // 移除方括号及其内容
  result = result.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();
  
  // 移除破折号后的内容
  result = result.split(/\s*-\s*|\s*–\s*|\s*—\s*/)[0].trim();
  
  // 移除常见后缀
  const patterns = [
    /\s*-\s*from.*$/i,
    /\s*-\s*official.*$/i,
    /\s*-\s*remastered.*$/i,
    /\s*-\s*mix.*$/i,
    /\s*-\s*edit.*$/i,
    /\s*-\s*live.*$/i,
    /\s*-\s*现场.*$/i,
    /\s*-\s*音乐会.*$/i,
    /\s*-\s*音乐节.*$/i,
    /\s*-\s*concert.*$/i,
  ];
  
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  
  // 移除多余空格
  result = result.replace(/\s+/g, ' ').trim();
  
  return result || songName;
}

// 更智能的评分系统 - 优化版本
function calculateSmartScore(song, targetTrack, artistName, originalTrackName, originalArtistName) {
  const songName = getSongName(song);
  if (!songName) return 0;
  
  const songTitle = songName.toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const originalTrackNameLower = originalTrackName.toLowerCase();
  const originalArtistNameLower = originalArtistName.toLowerCase();
  
  let titleScore = 0;
  let artistScore = 0;
  
  // 提取核心歌名（去掉括号内容）
  const coreSongName = extractCoreSongName(songName).toLowerCase();
  const coreOriginalTrackName = extractCoreSongName(originalTrackName).toLowerCase();
  
  // 计算歌曲名匹配分数 - 优先考虑核心歌名匹配
  if (coreSongName === coreOriginalTrackName) {
    titleScore = 90; // 核心歌名完全匹配
  } else if (songTitle === originalTrackNameLower) {
    titleScore = 85; // 完全匹配原始歌名
  } else if (songTitle.includes(coreOriginalTrackName) && coreOriginalTrackName.length > 3) {
    titleScore = 75; // 包含核心原始歌名
  } else if (coreOriginalTrackName.includes(coreSongName) && coreSongName.length > 3) {
    titleScore = 70; // 被核心原始歌名包含
  }
  
  // 艺术家匹配逻辑
  const songArtistArray = songArtists.split(/\s*\/\s*|\s*,\s*|\s+&\s+/).map(a => a.trim().toLowerCase());
  
  // 检查传入的艺术家是否在歌曲艺术家数组中
  let exactArtistMatch = false;
  let partialArtistMatch = false;
  
  for (const songArtist of songArtistArray) {
    // 完全匹配
    if (songArtist === originalArtistNameLower) {
      exactArtistMatch = true;
      break;
    }
    // 部分匹配（包含关系）
    if (songArtist.includes(originalArtistNameLower) || originalArtistNameLower.includes(songArtist)) {
      partialArtistMatch = true;
    }
  }
  
  // 分配艺术家分数
  if (exactArtistMatch) {
    artistScore = 100; // 完全匹配
  } else if (partialArtistMatch) {
    artistScore = 80;  // 部分匹配
  } else if (songArtists.includes(originalArtistNameLower)) {
    artistScore = 70;  // 字符串包含
  }
  
  // 计算基础分数
  let totalScore = (titleScore * 0.7) + (artistScore * 0.3);
  
  // 特殊奖励：给没有括号的版本额外加分
  if (!songName.includes('(') && !songName.includes('（') && !songName.includes('-')) {
    totalScore += 30; // 干净版本大额加分
  }
  
  // 特殊惩罚：给现场版、混音版等降低分数
  const isLiveVersion = songName.match(/\(.*(现场|live|音乐会|音乐节|concert).*\)/i) || 
                       songName.match(/-.*(现场|live|音乐会|音乐节|concert).*$/i);
  const isRemixVersion = songName.match(/\(.*(remix|mix|edit|version|acoustic|instrumental).*\)/i) ||
                        songName.match(/-.*(remix|mix|edit|version|acoustic|instrumental).*$/i);
  
  if (isLiveVersion) {
    totalScore -= 50; // 现场版大幅减分
  } else if (isRemixVersion) {
    totalScore -= 25; // 混音版减分
  }
  
  // 特殊奖励：给原版专辑版本加分
  if (songName.toLowerCase().includes(coreOriginalTrackName) && 
      !isLiveVersion && 
      !isRemixVersion &&
      !songName.includes('(') && !songName.includes('（')) {
    totalScore += 40; // 原版大额加分
  }
  
  return Math.min(Math.max(totalScore, 0), 100);
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

// 获取歌词（使用合并的过滤逻辑）
async function getLyrics(songId) {
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    return processLyricsData(data);
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 合并的歌词数据处理函数
function processLyricsData(data) {
  let syncedLyrics = '';
  let plainLyrics = '';
  let translatedLyrics = '';
  let yrcLyrics = '';
  
  if (data?.code === 200 && data.data) {
    // 处理LRC歌词
    if (data.data.lrc) {
      syncedLyrics = filterLyrics(data.data.lrc, 'lrc');
      plainLyrics = '';
    }
    
    // 处理翻译歌词
    if (data.data.trans) {
      translatedLyrics = filterLyrics(data.data.trans, 'lrc');
    }
    
    // 处理YRC歌词，使用与LRC相同的过滤规则
    if (data.data.yrc) {
      yrcLyrics = filterLyrics(data.data.yrc, 'yrc');
    }
  }
  
  return { 
    syncedLyrics, 
    plainLyrics, 
    translatedLyrics,
    yrcLyrics
  };
}

// 统一的歌词过滤函数
function filterLyrics(lyricContent, type = 'lrc') {
  if (!lyricContent) return '';
  
  // 统一的行分割处理
  const lines = lyricContent.replace(/\r\n/g, '\n').split('\n');
  
  // 移除元数据标签行（LRC和YRC共用）
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    return !(/^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed));
  });
  
  // 统一的歌词行处理
  const processedLines = [];
  
  for (const line of filteredLines) {
    if (type === 'lrc') {
      // 解析LRC格式行
      const match = line.match(/^(\[[0-9:.]+\])(.*)$/);
      if (match) {
        processedLines.push({
          raw: line,
          text: match[2].trim(),
          plainText: match[2].trim().replace(/\[.*?\]/g, ''),
          type: 'lrc'
        });
      }
    } else if (type === 'yrc') {
      // 解析YRC格式行
      const match = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (match) {
        const content = match[3].trim();
        processedLines.push({
          raw: line,
          text: content,
          plainText: extractPlainTextFromYrc(content),
          type: 'yrc'
        });
      }
    }
  }
  
  // 使用统一的过滤规则
  return filterLyricsLines(processedLines, type);
}

// 统一的歌词过滤函数
function filterLyricsLines(parsedLines, type = 'lrc') {
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
    if (type === 'lrc' && (/^\/\/\s*$/.test(text) || /^\[\d+:\d+(\.\d+)?\]\s*\/\/\s*$/.test(line.raw))) {
      return false;
    }
    
    // 移除只有时间轴的空行（如 [00:23.53]）
    if (type === 'lrc' && /^\[\d+:\d+(\.\d+)?\]\s*$/.test(line.raw)) {
      return false;
    }
    
    // 对于YRC，移除空内容行
    if (type === 'yrc' && text === '') {
      return false;
    }
    
    return true;
  });
  
  // 重新组合成对应格式
  const result = filtered.map(line => line.raw).join('\n');
  
  return result;
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

// 获取空的歌词对象
function getEmptyLyrics() {
  return { 
    syncedLyrics: '', 
    plainLyrics: '', 
    translatedLyrics: '',
    yrcLyrics: ''
  };
}