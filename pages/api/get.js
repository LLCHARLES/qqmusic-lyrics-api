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
    console.log('=== 开始处理搜索请求 ===');
    console.log('搜索请求:', { trackName: finalTrackName, artistName: finalArtistName });
    
    // 检查是否需要直接映射到特定MID
    const mappedMid = checkSongMapping(finalTrackName, finalArtistName);
    if (mappedMid) {
      console.log(`检测到映射歌曲，直接使用MID: ${mappedMid}`);
      return await handleMappedSong(mappedMid, finalTrackName, finalArtistName, res);
    }
    
    // 预处理
    const processedTrackName = preprocessTrackName(finalTrackName);
    const processedArtists = preprocessArtists(finalArtistName);
    console.log('预处理结果:', { 
      原始歌名: finalTrackName, 
      处理后的歌名: processedTrackName,
      原始艺人: finalArtistName,
      处理后的艺人数组: processedArtists 
    });
    
    console.log('正常搜索:', processedTrackName);
    
    // 搜索
    const song = await searchSong(processedTrackName, processedArtists, finalTrackName, finalArtistName);
    
    if (!song) {
      console.log('=== 未找到匹配的歌曲 ===');
      return res.status(404).json({ error: 'Song not found', message: '未找到匹配的歌曲' });
    }
    
    console.log('找到歌曲:', { 
      歌曲名: getSongName(song), 
      艺人: extractArtists(song), 
      歌曲ID: song.id,
      歌曲信息: JSON.stringify(song, null, 2).substring(0, 500) // 限制输出长度
    });
    
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
    
    console.log('=== 搜索成功，返回结果 ===');
    res.status(200).json(response);
    
  } catch (error) {
    console.error('API 错误:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// 检查歌曲映射
function checkSongMapping(originalTrackName, originalArtistName) {
  console.log('检查歌曲映射:', { originalTrackName, originalArtistName });
  const key = `${originalTrackName}_${originalArtistName}`;
  if (songMapping[key]) {
    console.log(`找到映射歌曲: ${key} -> ${songMapping[key]}`);
    return songMapping[key];
  }
  console.log('未找到映射歌曲');
  return null;
}

// 处理映射歌曲
async function handleMappedSong(mappedMid, originalTrackName, originalArtistName, res) {
  try {
    console.log('处理映射歌曲:', { mappedMid, originalTrackName, originalArtistName });
    
    // 首先，通过MID获取歌词
    console.log(`通过MID获取歌词: ${mappedMid}`);
    const lyrics = await getLyricsByMid(mappedMid);
    
    // 然后，尝试通过搜索API获取歌曲信息
    let songInfo = null;
    try {
      console.log('通过搜索API获取映射歌曲信息...');
      songInfo = await searchSongByMapping(originalTrackName, originalArtistName);
      
      // 如果搜索到的歌曲MID与映射MID不一致，使用映射MID
      if (songInfo && songInfo.mid !== mappedMid) {
        console.log('搜索到的MID与映射MID不一致，使用映射MID:', { 搜索MID: songInfo.mid, 映射MID: mappedMid });
        // 我们仍然使用映射MID，但保留搜索结果中的歌曲信息
        songInfo.mid = mappedMid;
        songInfo.id = mappedMid;
      }
    } catch (error) {
      console.log('无法通过搜索API获取歌曲信息，使用默认信息:', error.message);
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
    
    console.log('映射歌曲处理完成');
    res.status(200).json(response);
    
  } catch (error) {
    console.error('处理映射歌曲失败:', error);
    res.status(500).json({ error: 'Failed to get mapped song', message: error.message });
  }
}

// 通过映射表的歌名艺人搜索歌曲信息
async function searchSongByMapping(trackName, artistName) {
  console.log('搜索映射歌曲信息:', { trackName, artistName });
  
  // 使用原始歌名和艺人名搜索
  const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(trackName + ' ' + artistName)}&num=3`;
  console.log('映射歌曲搜索URL:', searchUrl);
  
  const response = await axios.get(searchUrl);
  const data = response.data;
  
  console.log('映射歌曲搜索结果:', { code: data?.code, 结果数量: data.data?.length });
  
  if (data?.code === 200 && data.data?.length > 0) {
    console.log('找到映射歌曲信息:', getSongName(data.data[0]));
    return data.data[0]; // 返回第一个结果
  }
  
  throw new Error('无法通过搜索API获取歌曲信息');
}

// 通过MID获取歌词
async function getLyricsByMid(mid) {
  try {
    console.log(`通过MID获取歌词: ${mid}`);
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?mid=${mid}`;
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    return processLyricsData(data);
    
  } catch (error) {
    console.error('通过MID获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 预处理艺术家
function preprocessArtists(artistName) {
  console.log('预处理艺术家:', artistName);
  const artists = artistName.split(/\s*,\s*|\s+&\s+|\s+和\s+/);
  const result = [...new Set(artists.filter(artist => artist.trim()))];
  console.log('预处理艺术家结果:', result);
  return result;
}

// 预处理歌名
function preprocessTrackName(trackName) {
  console.log('预处理歌名:', trackName);
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
    const original = processed;
    processed = processed.replace(pattern, '');
    if (original !== processed) {
      console.log(`应用模式 ${pattern}: ${original} -> ${processed}`);
    }
  }
  
  processed = processed.replace(/\s+/g, ' ').replace(/[-\s]+$/g, '').trim();
  const result = processed || trackName.split(/[-\s–—]/)[0].trim();
  console.log('预处理歌名结果:', result);
  return result;
}

// 搜索歌曲
async function searchSong(trackName, artists, originalTrackName, originalArtistName) {
  console.log('开始搜索歌曲:', { 
    trackName, 
    artists, 
    originalTrackName, 
    originalArtistName 
  });
  
  // 判断是否需要简化搜索
  const shouldSimplify = trackName.length > 30 || 
    / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName);
  
  console.log('是否需要简化搜索:', shouldSimplify, '原因:', {
    长度超过30: trackName.length > 30,
    包含特殊字符: / - | – | — |\(|\)|《|》|动画|剧集|主题曲|anniversary|theme song|version|remastered|mix|edit|致.*先生|———/i.test(trackName)
  });
  
  if (shouldSimplify) {
    console.log('使用简化搜索');
    return await simplifiedSearch(trackName, artists, originalTrackName, originalArtistName);
  }
  
  // 正常搜索 - 限制返回3个结果
  console.log('开始正常搜索，艺术家列表:', artists);
  for (const artist of artists) {
    const searchKeyword = `${trackName} ${artist}`;
    const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(searchKeyword)}&num=3`;
    console.log(`尝试搜索: ${searchKeyword}`);
    console.log('搜索URL:', searchUrl);
    
    try {
      console.log('发送搜索请求...');
      const response = await axios.get(searchUrl);
      const data = response.data;
      
      console.log('搜索响应:', { 
        状态码: data?.code,
        结果数量: data.data?.length,
        是否有数据: !!data.data,
        是否成功: data?.code === 200 && data.data?.length > 0
      });
      
      if (data?.code === 200 && data.data?.length > 0) {
        console.log(`搜索到 ${data.data.length} 个结果`);
        console.log('搜索结果预览:', data.data.map(item => ({
          歌名: getSongName(item),
          艺人: extractArtists(item),
          ID: item.id
        })));
        
        const match = findBestMatch(data.data, trackName, artists, originalTrackName, originalArtistName);
        if (match) {
          console.log('找到最佳匹配:', { 歌名: getSongName(match), 艺人: extractArtists(match) });
          return match;
        } else {
          console.log('未找到匹配项');
        }
      } else {
        console.log('搜索无结果或失败');
      }
    } catch (error) {
      console.error('搜索失败:', error.message, error.response?.status);
    }
  }
  
  console.log('所有搜索尝试均失败');
  return null;
}

// 简化搜索
async function simplifiedSearch(trackName, artists, originalTrackName, originalArtistName) {
  console.log('开始简化搜索');
  const strategies = [
    // 策略1: 核心歌名 + 艺术家
    () => {
      const coreName = extractCoreName(trackName);
      console.log('策略1 - 核心歌名:', coreName);
      return artists.map(artist => `${coreName} ${artist}`);
    },
    // 策略2: 预处理歌名 + 艺术家
    () => {
      const processed = preprocessTrackName(trackName);
      console.log('策略2 - 预处理歌名:', processed);
      return artists.map(artist => `${processed} ${artist}`);
    },
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    console.log(`尝试策略 ${i+1}`);
    try {
      const keywords = strategies[i]();
      console.log(`策略 ${i+1} 关键词:`, keywords);
      
      for (const keyword of keywords) {
        console.log(`搜索关键词: ${keyword}`);
        // 限制返回3个结果
        const searchUrl = `https://api.vkeys.cn/v2/music/tencent/search/song?word=${encodeURIComponent(keyword)}&num=3`;
        console.log('简化搜索URL:', searchUrl);
        
        const response = await axios.get(searchUrl);
        const data = response.data;
        
        console.log(`策略 ${i+1} 搜索结果:`, { 
          状态码: data?.code,
          结果数量: data.data?.length 
        });
        
        if (data?.code === 200 && data.data?.length > 0) {
          console.log(`策略 ${i+1} 找到 ${data.data.length} 个结果`);
          const match = findBestMatch(data.data, trackName, artists, originalTrackName, originalArtistName);
          if (match) {
            console.log(`策略 ${i+1} 找到匹配:`, { 歌名: getSongName(match), 艺人: extractArtists(match) });
            return match;
          } else {
            console.log(`策略 ${i+1} 未找到匹配项`);
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.warn(`策略${i+1} 失败:`, error.message);
    }
  }
  
  console.log('所有简化搜索策略均失败');
  return null;
}

// 提取核心歌名
function extractCoreName(text) {
  console.log('提取核心歌名:', text);
  const isEnglish = /^[a-zA-Z\s.,!?'"-]+$/.test(text);
  console.log('是否为英文:', isEnglish);
  
  if (isEnglish) {
    const processed = preprocessTrackName(text);
    const result = processed && processed.length < text.length ? processed : text;
    console.log('英文核心歌名:', result);
    return result;
  }
  
  const japanesePart = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  if (japanesePart) {
    console.log('日文/中文核心部分:', japanesePart[0]);
    return japanesePart[0];
  }
  
  const processed = preprocessTrackName(text);
  const result = processed && processed.length < text.length ? processed : text.split(/[-\s–—|]/)[0] || text;
  console.log('其他核心歌名:', result);
  return result;
}

// 查找最佳匹配
function findBestMatch(results, targetTrack, artists, originalTrackName, originalArtistName) {
  console.log('开始查找最佳匹配:', {
    结果数量: results.length,
    目标歌名: targetTrack,
    原始歌名: originalTrackName,
    艺术家: artists
  });
  
  // 先尝试精确匹配（歌曲名和艺术家都匹配）
  console.log('尝试精确匹配...');
  const exactMatch = findExactMatch(results, originalTrackName, originalArtistName);
  if (exactMatch) {
    console.log('找到精确匹配:', { 歌名: getSongName(exactMatch), 艺人: extractArtists(exactMatch) });
    return exactMatch;
  }
  console.log('未找到精确匹配');
  
  // 使用更智能的评分系统
  let bestMatch = null;
  let bestScore = 0;
  
  console.log('开始评分匹配...');
  for (const song of results) {
    const score = calculateSmartScore(song, targetTrack, artists, originalTrackName, originalArtistName);
    console.log(`歌曲评分: ${getSongName(song)} (${extractArtists(song)}) - 得分: ${score}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = song;
      console.log(`更新最佳匹配: ${getSongName(song)} (得分: ${score})`);
    }
  }
  
  const finalMatch = bestMatch || (results.length > 0 ? results[0] : null);
  console.log('最终匹配结果:', finalMatch ? {
    歌名: getSongName(finalMatch),
    艺人: extractArtists(finalMatch),
    得分: bestScore
  } : '无匹配');
  
  return finalMatch;
}

// 精确匹配 - 要求歌曲名和艺术家都匹配
function findExactMatch(results, originalTrackName, originalArtistName) {
  console.log('精确匹配检查:', { 
    原始歌名: originalTrackName, 
    原始艺人: originalArtistName,
    结果数量: results.length 
  });
  
  const trackLower = originalTrackName.toLowerCase();
  const artistLower = originalArtistName.toLowerCase();
  
  for (const song of results) {
    const songName = getSongName(song);
    const songArtists = extractArtists(song);
    
    console.log(`检查歌曲: ${songName} - ${songArtists}`);
    
    if (songName && songArtists) {
      const songNameLower = songName.toLowerCase();
      const songArtistsLower = songArtists.toLowerCase();
      
      // 要求歌曲名和艺术家都完全匹配
      if (songNameLower === trackLower && songArtistsLower === artistLower) {
        console.log('找到精确匹配!');
        return song;
      }
    }
  }
  
  console.log('未找到精确匹配');
  return null;
}

// 更智能的评分系统
function calculateSmartScore(song, targetTrack, artists, originalTrackName, originalArtistName) {
  const songName = getSongName(song);
  if (!songName) {
    console.log(`歌曲 ${JSON.stringify(song)} 无名称，得分为0`);
    return 0;
  }
  
  const songTitle = songName.toLowerCase();
  const songArtists = extractArtists(song).toLowerCase();
  const targetTrackLower = targetTrack.toLowerCase();
  const originalTrackNameLower = originalTrackName.toLowerCase();
  const originalArtistNameLower = originalArtistName.toLowerCase();
  
  console.log(`评分: ${songName} (${extractArtists(song)})`);
  console.log('比较参数:', {
    歌曲名: songTitle,
    歌曲艺人: songArtists,
    目标歌名: targetTrackLower,
    原始歌名: originalTrackNameLower,
    原始艺人: originalArtistNameLower
  });
  
  let titleScore = 0;
  let artistScore = 0;
  
  // 计算歌曲名匹配分数 - 更智能的匹配
  if (songTitle === originalTrackNameLower) {
    titleScore = 100; // 完全匹配原始歌名 - 最高分
    console.log('歌曲名完全匹配原始歌名: +100分');
  } else if (songTitle === targetTrackLower) {
    titleScore = 90; // 完全匹配预处理歌名
    console.log('歌曲名完全匹配预处理歌名: +90分');
  } else if (isCloseMatch(songTitle, originalTrackNameLower)) {
    titleScore = 80; // 接近匹配原始歌名
    console.log('歌曲名接近匹配原始歌名: +80分');
  } else if (isCloseMatch(songTitle, targetTrackLower)) {
    titleScore = 70; // 接近匹配预处理歌名
    console.log('歌曲名接近匹配预处理歌名: +70分');
  } else if (songTitle.includes(originalTrackNameLower) && originalTrackNameLower.length > 3) {
    titleScore = 60; // 包含原始歌名
    console.log('歌曲名包含原始歌名: +60分');
  } else if (originalTrackNameLower.includes(songTitle) && songTitle.length > 3) {
    titleScore = 50; // 被原始歌名包含
    console.log('原始歌名包含歌曲名: +50分');
  } else if (songTitle.includes(targetTrackLower) && targetTrackLower.length > 3) {
    titleScore = 40; // 包含预处理歌名
    console.log('歌曲名包含预处理歌名: +40分');
  } else if (targetTrackLower.includes(songTitle) && songTitle.length > 3) {
    titleScore = 30; // 被预处理歌名包含
    console.log('预处理歌名包含歌曲名: +30分');
  }
  
  console.log(`歌曲名得分: ${titleScore}`);
  
  // 计算艺术家匹配分数
  const songArtistsArray = songArtists.split(/\s*,\s*|\s+&\s+/);
  console.log('歌曲艺人数组:', songArtistsArray);
  
  for (const targetArtist of artists) {
    const targetArtistLower = targetArtist.toLowerCase();
    console.log(`比较目标艺人: ${targetArtistLower}`);
    
    for (const songArtist of songArtistsArray) {
      console.log(`  与歌曲艺人: ${songArtist}`);
      
      if (songArtist === originalArtistNameLower) {
        artistScore = Math.max(artistScore, 100); // 完全匹配原始艺术家名
        console.log('   完全匹配原始艺术家名: +100分');
        break;
      } else if (songArtist === targetArtistLower) {
        artistScore = Math.max(artistScore, 80); // 完全匹配预处理艺术家名
        console.log('   完全匹配预处理艺术家名: +80分');
        break;
      } else if (songArtist.includes(originalArtistNameLower) || originalArtistNameLower.includes(songArtist)) {
        artistScore = Math.max(artistScore, 60); // 部分匹配原始艺术家名
        console.log('   部分匹配原始艺术家名: +60分');
        break;
      } else if (songArtist.includes(targetArtistLower) || targetArtistLower.includes(songArtist)) {
        artistScore = Math.max(artistScore, 40); // 部分匹配预处理艺术家名
        console.log('   部分匹配预处理艺术家名: +40分');
        break;
      }
    }
    
    if (artistScore >= 100) break; // 已经找到完全匹配，可以提前结束
  }
  
  console.log(`艺术家得分: ${artistScore}`);
  
  // 计算综合分数 - 使用动态权重
  let titleWeight = 0.6;
  let artistWeight = 0.4;
  
  // 如果艺术家完全匹配但歌曲名部分匹配，增加艺术家权重
  if (artistScore >= 80 && titleScore >= 40) {
    titleWeight = 0.4;
    artistWeight = 0.6;
    console.log('调整权重: 艺术家权重增加');
  }
  
  // 如果歌曲名完全匹配但艺术家部分匹配，增加歌曲名权重
  if (titleScore >= 90 && artistScore >= 40) {
    titleWeight = 0.8;
    artistWeight = 0.2;
    console.log('调整权重: 歌曲名权重增加');
  }
  
  let totalScore = (titleScore * titleWeight) + (artistScore * artistWeight);
  console.log(`基础总分: ${totalScore} (${titleScore} * ${titleWeight} + ${artistScore} * ${artistWeight})`);
  
  // 特殊情况处理
  // 如果歌曲名完全匹配原始歌名，给予最高优先级
  if (songTitle === originalTrackNameLower) {
    totalScore = Math.max(totalScore, 95);
    console.log('歌曲名完全匹配原始歌名，总分提升至95');
  }
  
  // 如果歌曲名和艺术家都匹配得很好，给予额外奖励
  if (titleScore >= 70 && artistScore >= 80) {
    totalScore += 15;
    console.log('歌曲名和艺术家匹配良好，+15分奖励');
  }
  
  // 如果艺术家完全匹配但歌曲名部分匹配，给予中等奖励
  if (artistScore === 100 && titleScore >= 40) {
    totalScore += 10;
    console.log('艺术家完全匹配，+10分奖励');
  }
  
  console.log(`最终总分: ${totalScore}`);
  return totalScore;
}

// 判断是否为接近匹配
function isCloseMatch(songTitle, targetTitle) {
  console.log(`检查接近匹配: "${songTitle}" vs "${targetTitle}"`);
  
  // 移除常见修饰词
  const cleanSong = songTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  const cleanTarget = targetTitle.replace(/\(.*?\)| - .*|【.*?】/g, '').trim();
  
  console.log(`清理后: "${cleanSong}" vs "${cleanTarget}"`);
  
  // 如果清理后相同，则是接近匹配
  if (cleanSong === cleanTarget) {
    console.log('清理后相同，是接近匹配');
    return true;
  }
  
  // 如果是日文/中文歌曲，检查是否包含核心部分
  const hasJapaneseOrChinese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(targetTitle);
  if (hasJapaneseOrChinese) {
    const corePart = extractCorePart(targetTitle);
    console.log(`日文/中文歌曲，核心部分: "${corePart}"`);
    if (songTitle.includes(corePart)) {
      console.log(`歌曲名包含核心部分，是接近匹配`);
      return true;
    }
  }
  
  console.log('不是接近匹配');
  return false;
}

// 提取核心部分（日文/中文）
function extractCorePart(text) {
  const japaneseOrChineseMatch = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+/);
  const result = japaneseOrChineseMatch ? japaneseOrChineseMatch[0] : text.split(/\s+/)[0];
  console.log(`提取核心部分: "${text}" -> "${result}"`);
  return result;
}

// 获取歌曲名称
function getSongName(song) {
  const name = song.song || song.name || song.songname || song.title || song.songName;
  console.log(`获取歌曲名称: ${JSON.stringify(song)} -> "${name}"`);
  return name;
}

// 提取歌手信息
function extractArtists(song) {
  console.log('提取歌手信息:', JSON.stringify(song.singer));
  
  if (!song.singer) {
    console.log('无歌手信息，返回空字符串');
    return '';
  }
  
  let result = '';
  
  if (Array.isArray(song.singer)) {
    result = song.singer.map(s => {
      if (typeof s === 'object') return s.name || s.title || s.singer_name || '';
      return String(s);
    }).filter(Boolean).join(', ');
  } else if (typeof song.singer === 'object') {
    result = song.singer.name || song.singer.title || song.singer.singer_name || '';
  } else {
    result = String(song.singer);
  }
  
  console.log(`提取歌手信息结果: "${result}"`);
  return result;
}

// 提取专辑信息
function extractAlbumName(song) {
  console.log('提取专辑信息:', JSON.stringify(song.album));
  
  if (!song.album) {
    console.log('无专辑信息，返回空字符串');
    return '';
  }
  
  let result = '';
  if (typeof song.album === 'object') {
    result = song.album.name || song.album.title || '';
  } else {
    result = String(song.album);
  }
  
  console.log(`提取专辑信息结果: "${result}"`);
  return result;
}

// 计算时长
function calculateDuration(interval) {
  console.log('计算时长:', interval);
  
  if (!interval) {
    console.log('无时长信息，返回0');
    return 0;
  }
  
  let result = 0;
  
  if (typeof interval === 'string') {
    if (interval.includes('分') && interval.includes('秒')) {
      const match = interval.match(/(\d+)分(\d+)秒/);
      if (match) {
        result = parseInt(match[1]) * 60 + parseInt(match[2]);
        console.log(`解析"分秒"格式: ${interval} -> ${result}秒`);
      }
    } else if (interval.includes(':')) {
      const [minutes, seconds] = interval.split(':').map(Number);
      if (!isNaN(minutes) && !isNaN(seconds)) {
        result = minutes * 60 + seconds;
        console.log(`解析"时分"格式: ${interval} -> ${result}秒`);
      }
    } else if (!isNaN(Number(interval))) {
      result = Number(interval);
      console.log(`解析数字格式: ${interval} -> ${result}秒`);
    }
  } else if (typeof interval === 'number') {
    result = interval;
    console.log(`直接使用数字: ${interval}秒`);
  }
  
  console.log(`最终时长: ${result}秒`);
  return result;
}

// 获取歌词（使用合并的过滤逻辑）
async function getLyrics(songId) {
  console.log(`获取歌词: ${songId}`);
  try {
    const lyricUrl = `https://api.vkeys.cn/v2/music/tencent/lyric?id=${songId}`;
    console.log('歌词API URL:', lyricUrl);
    
    const response = await axios.get(lyricUrl);
    const data = response.data;
    
    console.log('歌词API响应:', { 状态码: data?.code, 是否有数据: !!data.data });
    
    return processLyricsData(data);
    
  } catch (error) {
    console.error('获取歌词失败:', error);
    return getEmptyLyrics();
  }
}

// 合并的歌词数据处理函数
function processLyricsData(data) {
  console.log('处理歌词数据');
  
  let syncedLyrics = '';
  let plainLyrics = '';
  let translatedLyrics = '';
  let yrcLyrics = '';
  
  if (data?.code === 200 && data.data) {
    console.log('歌词数据可用');
    
    // 处理LRC歌词
    if (data.data.lrc) {
      console.log('处理LRC歌词，长度:', data.data.lrc.length);
      syncedLyrics = filterLyrics(data.data.lrc, 'lrc');
      plainLyrics = '';
    }
    
    // 处理翻译歌词
    if (data.data.trans) {
      console.log('处理翻译歌词，长度:', data.data.trans.length);
      translatedLyrics = filterLyrics(data.data.trans, 'lrc');
    }
    
    // 处理YRC歌词，使用与LRC相同的过滤规则
    if (data.data.yrc) {
      console.log('处理YRC歌词，长度:', data.data.yrc.length);
      yrcLyrics = filterLyrics(data.data.yrc, 'yrc');
    }
  } else {
    console.log('歌词数据不可用或状态码错误');
  }
  
  console.log('歌词处理完成:', {
    LRC长度: syncedLyrics.length,
    翻译长度: translatedLyrics.length,
    YRC长度: yrcLyrics.length
  });
  
  return { 
    syncedLyrics, 
    plainLyrics, 
    translatedLyrics,
    yrcLyrics
  };
}

// 统一的歌词过滤函数
function filterLyrics(lyricContent, type = 'lrc', referenceLyrics = '') {
  console.log(`过滤${type}歌词，原始长度: ${lyricContent?.length || 0}`);
  
  if (!lyricContent) {
    console.log('歌词内容为空');
    return '';
  }
  
  // 基础预处理：分割行和移除元数据
  const { lines, parsedLines } = preprocessLyricLines(lyricContent, type);
  console.log(`预处理后: ${lines.length}行 -> ${parsedLines.length}解析行`);
  
  if (type === 'lrc') {
    const result = filterLrcLyrics(parsedLines);
    console.log(`LRC过滤后长度: ${result.length}`);
    return result;
  } else if (type === 'yrc') {
    // YRC使用与LRC相同的过滤规则
    const result = filterYrcLyrics(parsedLines);
    console.log(`YRC过滤后长度: ${result.length}`);
    return result;
  }
  
  return '';
}

// 预处理歌词行（LRC和YRC共用）
function preprocessLyricLines(lyricContent, type) {
  console.log(`预处理${type}歌词行`);
  
  // 统一的行分割处理
  const lines = lyricContent.replace(/\r\n/g, '\n').split('\n');
  console.log(`分割为${lines.length}行`);
  
  // 移除元数据标签行（LRC和YRC共用）
  const filteredLines = lines.filter(line => {
    const trimmed = line.trim();
    const isMetadata = /^\[(ti|ar|al|by|offset|t_time|kana|lang|total):.*\]$/i.test(trimmed);
    if (isMetadata) {
      console.log(`移除元数据行: ${trimmed.substring(0, 50)}...`);
    }
    return !isMetadata;
  });
  
  console.log(`移除元数据后剩余${filteredLines.length}行`);
  
  let parsedLines = [];
  
  if (type === 'lrc') {
    // 解析LRC格式行
    for (const line of filteredLines) {
      const match = line.match(/^(\[[0-9:.]+\])(.*)$/);
      if (match) {
        parsedLines.push({
          raw: line,
          timestamp: match[1],
          text: match[2].trim(),
          plainText: match[2].trim().replace(/\[.*?\]/g, ''),
          type: 'lrc'
        });
      } else {
        console.log(`LRC无法解析的行: ${line.substring(0, 50)}...`);
      }
    }
  } else if (type === 'yrc') {
    // 解析YRC格式行
    for (const line of filteredLines) {
      const match = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (match) {
        const startTime = parseInt(match[1]);
        const duration = parseInt(match[2]);
        const content = match[3].trim();
        
        parsedLines.push({
          raw: line,
          startTime,
          duration,
          content,
          plainText: extractPlainTextFromYrc(content),
          type: 'yrc'
        });
      } else {
        console.log(`YRC无法解析的行: ${line.substring(0, 50)}...`);
      }
    }
  }
  
  console.log(`解析为${parsedLines.length}行`);
  return { lines, parsedLines };
}

// LRC歌词过滤
function filterLrcLyrics(parsedLines) {
  console.log(`过滤LRC歌词，共${parsedLines.length}行`);
  
  // 2) 基础序列 - 按时间戳排序
  let filtered = [...parsedLines];
  
  // 收集"被删除的冒号行"的纯文本
  let removedColonPlainTexts = [];
  
  // 2) A) 标题行（仅前三行内；含 '-' 就删）
  let i = 0;
  let scanLimit = Math.min(3, filtered.length);
  console.log(`检查前${scanLimit}行标题行`);
  
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    console.log(`检查第${i+1}行: "${text}"`);
    
    if (text.includes('-')) {
      console.log(`包含"-"，删除: "${text}"`);
      filtered.splice(i, 1);
      scanLimit = Math.min(3, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  console.log(`标题行检查后剩余${filtered.length}行`);
  
  // 2.5) A2) 前三行内：含冒号的行直接删除
  let removedA2Colon = false;
  i = 0;
  scanLimit = Math.min(3, filtered.length);
  console.log(`检查前${scanLimit}行冒号行`);
  
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    console.log(`检查第${i+1}行: "${text}"`);
    
    if (containsColon(text)) {
      console.log(`包含冒号，删除: "${text}"`);
      removedColonPlainTexts.push(text);
      filtered.splice(i, 1);
      removedA2Colon = true;
      scanLimit = Math.min(3, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  console.log(`冒号行检查后剩余${filtered.length}行，是否删除冒号行: ${removedA2Colon}`);
  
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
  
  console.log(`开头连续冒号行数量: ${leading}`);
  
  if (removedA2Colon) {
    if (leading >= 1) {
      console.log(`删除前${leading}行连续冒号行`);
      for (let idx = 0; idx < leading; idx++) {
        removedColonPlainTexts.push(filtered[idx].plainText);
      }
      filtered.splice(0, leading);
    }
  } else {
    if (leading >= 2) {
      console.log(`删除前${leading}行连续冒号行`);
      for (let idx = 0; idx < leading; idx++) {
        removedColonPlainTexts.push(filtered[idx].plainText);
      }
      filtered.splice(0, leading);
    }
  }
  
  console.log(`连续冒号行处理后剩余${filtered.length}行`);
  
  // 3) 制作行（全局）：删除任意位置出现的"连续 ≥2 行均含冒号"的区间
  let newFiltered = [];
  i = 0;
  console.log('全局检查连续冒号行区间');
  
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
      console.log(`找到连续冒号行区间: 位置${i}-${j-1}, 长度${runLen}`);
      
      if (runLen >= 2) {
        // 收集整段 i..<(i+runLen) 的纯文本后丢弃
        console.log(`删除连续冒号行区间(长度>=2)`);
        for (let k = i; k < j; k++) {
          removedColonPlainTexts.push(filtered[k].plainText);
        }
        i = j;
      } else {
        // 仅 1 行，保留
        console.log(`保留单行冒号行: "${filtered[i].plainText}"`);
        newFiltered.push(filtered[i]);
        i = j;
      }
    } else {
      newFiltered.push(filtered[i]);
      i += 1;
    }
  }
  filtered = newFiltered;
  
  console.log(`全局连续冒号行处理后剩余${filtered.length}行`);
  
  // 4) C) 全局删除：凡包含【】或 [] 的行一律删除
  const beforeBracket = filtered.length;
  filtered = filtered.filter(line => {
    const hasBracket = containsBracketTag(line.plainText);
    if (hasBracket) {
      console.log(`删除包含括号的行: "${line.plainText.substring(0, 50)}..."`);
    }
    return !hasBracket;
  });
  
  console.log(`括号行删除后: ${beforeBracket} -> ${filtered.length}行`);
  
  // 4.5) C2) 处理开头两行的"圆括号标签"
  i = 0;
  scanLimit = Math.min(2, filtered.length);
  console.log(`检查前${scanLimit}行圆括号标签`);
  
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    if (containsParenPair(text)) {
      console.log(`删除包含圆括号的行: "${text}"`);
      filtered.splice(i, 1);
      scanLimit = Math.min(2, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  console.log(`圆括号标签处理后剩余${filtered.length}行`);
  
  // 4.75) D) 全局删除：版权/授权/禁止类提示语
  const beforeLicense = filtered.length;
  filtered = filtered.filter(line => {
    const isLicense = isLicenseWarningLine(line.plainText);
    if (isLicense) {
      console.log(`删除版权行: "${line.plainText.substring(0, 50)}..."`);
    }
    return !isLicense;
  });
  
  console.log(`版权行删除后: ${beforeLicense} -> ${filtered.length}行`);
  
  // 5) 额外的清理步骤：移除空时间轴行和只有"//"的行
  const beforeClean = filtered.length;
  filtered = filtered.filter(line => {
    const text = line.plainText;
    
    // 移除空行
    if (text === '') {
      console.log('删除空行');
      return false;
    }
    
    // 移除只包含"//"的行
    if (text === '//') {
      console.log('删除"//"行');
      return false;
    }
    
    // 移除只包含时间轴后面只有"//"的行（如 [00:36.66]//）
    if (/^\/\/\s*$/.test(text) || /^\[\d+:\d+(\.\d+)?\]\s*\/\/\s*$/.test(line.raw)) {
      console.log(`删除"//"时间轴行: ${line.raw.substring(0, 50)}...`);
      return false;
    }
    
    // 移除只有时间轴的空行（如 [00:23.53]）
    if (/^\[\d+:\d+(\.\d+)?\]\s*$/.test(line.raw)) {
      console.log(`删除空时间轴行: ${line.raw}`);
      return false;
    }
    
    return true;
  });
  
  console.log(`额外清理后: ${beforeClean} -> ${filtered.length}行`);
  
  // 重新组合成LRC格式
  const result = filtered.map(line => line.raw).join('\n');
  
  console.log(`最终LRC歌词行数: ${filtered.length}, 字符数: ${result.length}`);
  return result;
}

// YRC歌词过滤 - 使用与LRC相同的过滤规则
function filterYrcLyrics(parsedLines) {
  console.log(`过滤YRC歌词，共${parsedLines.length}行`);
  
  // 使用与LRC相同的过滤逻辑
  let filtered = [...parsedLines];
  
  // 收集"被删除的冒号行"的纯文本
  let removedColonPlainTexts = [];
  
  // 1) 前三行内：含冒号的行直接删除
  let removedA2Colon = false;
  let i = 0;
  let scanLimit = Math.min(3, filtered.length);
  console.log(`检查YRC前${scanLimit}行冒号行`);
  
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    console.log(`检查YRC第${i+1}行: "${text}"`);
    
    if (containsColon(text)) {
      console.log(`YRC包含冒号，删除: "${text}"`);
      removedColonPlainTexts.push(text);
      filtered.splice(i, 1);
      removedA2Colon = true;
      scanLimit = Math.min(3, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  console.log(`YRC冒号行检查后剩余${filtered.length}行，是否删除冒号行: ${removedA2Colon}`);
  
  // 2) 处理"开头连续冒号行"
  let leading = 0;
  while (leading < filtered.length) {
    const text = filtered[leading].plainText;
    if (containsColon(text)) {
      leading += 1;
    } else {
      break;
    }
  }
  
  console.log(`YRC开头连续冒号行数量: ${leading}`);
  
  if (removedA2Colon) {
    if (leading >= 1) {
      console.log(`删除YRC前${leading}行连续冒号行`);
      for (let idx = 0; idx < leading; idx++) {
        removedColonPlainTexts.push(filtered[idx].plainText);
      }
      filtered.splice(0, leading);
    }
  } else {
    if (leading >= 2) {
      console.log(`删除YRC前${leading}行连续冒号行`);
      for (let idx = 0; idx < leading; idx++) {
        removedColonPlainTexts.push(filtered[idx].plainText);
      }
      filtered.splice(0, leading);
    }
  }
  
  console.log(`YRC连续冒号行处理后剩余${filtered.length}行`);
  
  // 3) 制作行（全局）：删除任意位置出现的"连续 ≥2 行均含冒号"的区间
  let newFiltered = [];
  i = 0;
  console.log('YRC全局检查连续冒号行区间');
  
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
      console.log(`YRC找到连续冒号行区间: 位置${i}-${j-1}, 长度${runLen}`);
      
      if (runLen >= 2) {
        // 收集整段 i..<(i+runLen) 的纯文本后丢弃
        console.log(`YRC删除连续冒号行区间(长度>=2)`);
        for (let k = i; k < j; k++) {
          removedColonPlainTexts.push(filtered[k].plainText);
        }
        i = j;
      } else {
        // 仅 1 行，保留
        console.log(`YRC保留单行冒号行: "${filtered[i].plainText}"`);
        newFiltered.push(filtered[i]);
        i = j;
      }
    } else {
      newFiltered.push(filtered[i]);
      i += 1;
    }
  }
  filtered = newFiltered;
  
  console.log(`YRC全局连续冒号行处理后剩余${filtered.length}行`);
  
  // 4) 全局删除：凡包含【】或 [] 的行一律删除
  const beforeBracket = filtered.length;
  filtered = filtered.filter(line => {
    const hasBracket = containsBracketTag(line.plainText);
    if (hasBracket) {
      console.log(`YRC删除包含括号的行: "${line.plainText.substring(0, 50)}..."`);
    }
    return !hasBracket;
  });
  
  console.log(`YRC括号行删除后: ${beforeBracket} -> ${filtered.length}行`);
  
  // 5) 处理开头两行的"圆括号标签"
  i = 0;
  scanLimit = Math.min(2, filtered.length);
  console.log(`YRC检查前${scanLimit}行圆括号标签`);
  
  while (i < scanLimit) {
    const text = filtered[i].plainText;
    if (containsParenPair(text)) {
      console.log(`YRC删除包含圆括号的行: "${text}"`);
      filtered.splice(i, 1);
      scanLimit = Math.min(2, filtered.length);
      continue;
    } else {
      i += 1;
    }
  }
  
  console.log(`YRC圆括号标签处理后剩余${filtered.length}行`);
  
  // 6) 全局删除：版权/授权/禁止类提示语
  const beforeLicense = filtered.length;
  filtered = filtered.filter(line => {
    const isLicense = isLicenseWarningLine(line.plainText);
    if (isLicense) {
      console.log(`YRC删除版权行: "${line.plainText.substring(0, 50)}..."`);
    }
    return !isLicense;
  });
  
  console.log(`YRC版权行删除后: ${beforeLicense} -> ${filtered.length}行`);
  
  // 7) 额外的清理步骤：移除空行
  const beforeClean = filtered.length;
  filtered = filtered.filter(line => {
    const text = line.plainText;
    
    // 移除空行
    if (text === '') {
      console.log('YRC删除空行');
      return false;
    }
    
    // 移除只包含"//"的行
    if (text === '//') {
      console.log('YRC删除"//"行');
      return false;
    }
    
    return true;
  });
  
  console.log(`YRC额外清理后: ${beforeClean} -> ${filtered.length}行`);
  
  // 重新组合成YRC格式
  const result = filtered.map(line => line.raw).join('\n');
  
  console.log(`最终YRC歌词行数: ${filtered.length}, 字符数: ${result.length}`);
  return result;
}

// 从YRC内容中提取纯文本（移除时间标记）
function extractPlainTextFromYrc(yrcContent) {
  console.log(`提取YRC纯文本: "${yrcContent.substring(0, 50)}..."`);
  
  if (!yrcContent) {
    console.log('YRC内容为空');
    return '';
  }
  
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
  
  const result = plainText.trim();
  console.log(`YRC纯文本结果: "${result.substring(0, 50)}..."`);
  return result;
}

// 辅助函数 - 检查是否包含冒号（中英文冒号）
function containsColon(text) {
  const hasColon = text.includes(':') || text.includes('：');
  console.log(`检查冒号: "${text.substring(0, 30)}..." -> ${hasColon}`);
  return hasColon;
}

// 辅助函数 - 检查是否包含括号标签
function containsBracketTag(text) {
  const hasHalfPair = text.includes('[') && text.includes(']');
  const hasFullPair = text.includes('【') && text.includes('】');
  const result = hasHalfPair || hasFullPair;
  console.log(`检查括号: "${text.substring(0, 30)}..." -> ${result}`);
  return result;
}

// 辅助函数 - 检查是否包含圆括号对
function containsParenPair(text) {
  const hasHalfPair = text.includes('(') && text.includes(')');
  const hasFullPair = text.includes('（') && text.includes('）');
  const result = hasHalfPair || hasFullPair;
  console.log(`检查圆括号: "${text.substring(0, 30)}..." -> ${result}`);
  return result;
}

// 辅助函数 - 检查是否是版权警告行
function isLicenseWarningLine(text) {
  console.log(`检查版权行: "${text.substring(0, 50)}..."`);
  
  if (!text) {
    console.log('文本为空，不是版权行');
    return false;
  }
  
  // 特殊关键词 - 只要包含这些词就直接认为是版权行
  const specialKeywords = ['文曲大模型', '享有本翻译作品的著作权'];
  for (const keyword of specialKeywords) {
    if (text.includes(keyword)) {
      console.log(`包含特殊关键词"${keyword}"，是版权行`);
      return true;
    }
  }
  
  // 普通关键词 - 需要命中多个才认为是版权行
  const tokens = ['未经', '许可', '授权', '不得', '请勿', '使用', '版权', '翻唱'];
  let count = 0;
  for (const token of tokens) {
    if (text.includes(token)) {
      count += 1;
      console.log(`包含关键词"${token}"，计数: ${count}`);
    }
  }
  
  const result = count >= 3;
  console.log(`版权行检查结果: ${result} (计数: ${count})`);
  return result;
}

// 获取空的歌词对象
function getEmptyLyrics() {
  console.log('返回空的歌词对象');
  return { 
    syncedLyrics: '', 
    plainLyrics: '', 
    translatedLyrics: '',
    yrcLyrics: ''
  };
}
