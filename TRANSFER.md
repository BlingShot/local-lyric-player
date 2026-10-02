# Lyric Player 实现逻辑与 macOS / iOS 迁移方案

> 基于 2026-10-01 阅读的本仓库代码，`package.json` 版本为 0.8.4。已使用 CodeGraph 查询架构、符号调用关系与 Studio 依赖，并核对当前源码。
>
> 本文区分「现有实现」与「迁移建议」。两端均迁移本地音乐播放器、歌词展示与管理、分析及设置；**macOS 版完整迁移 Lyric Studio，iOS 版不迁移 Studio 的编辑器、打轴、工程及草稿恢复功能**。Studio 的实现说明用于指导 macOS 迁移，依赖拆分用于支持不含编辑器的 iOS 版。本文是方案文档，不表示 Apple 平台已完成实现或验证。

## 1. 产品边界与整体架构

应用是离线优先的本地音乐播放器。用户导入音频后，应用保存自己的音频副本，读取标签、封面与内嵌歌词，以稳定歌曲 ID 关联播放、歌词、分析和播放列表。用户选择的原始文件不会被歌词写入功能直接修改。

现有两种运行环境：

| 层次 | Web | Windows Electron |
| --- | --- | --- |
| UI | React 19、Ant Design、CSS / SCSS | 复用同一套 UI |
| 状态 | Redux Toolkit + 模块级服务 | 同左 |
| 持久化 | IndexedDB、localStorage | Chromium IndexedDB、localStorage，以及主进程配置文件 |
| 播放 | HTMLAudioElement；必要时接 Web Audio 增益图 | 默认 Chromium 媒体管线；选择原生输出时使用 mpv |
| 元数据 | Worker 内 music-metadata | 同左 |
| 分析 | Web Audio 解码、Worker / WASM 计算 | 同左；原生输出并不替换分析解码器 |
| 系统集成 | 浏览器提供的能力 | preload 白名单、IPC、文件夹扫描、日志、字体、输出设备 |

```text
React 页面 / 组件
  ├─ Redux：可序列化的曲库、播放、UI 状态
  ├─ runtime：全局播放器、音频 Blob、封面 URL、写操作队列
  ├─ lyrics：解析、来源管理、偏移、时钟、布局、展示
  ├─ analysis：输入快照、任务、算法、结果与失效判断
  └─ repository / database：IndexedDB 事务
          │
          └─ Electron 环境的有限 bridge
                → 主进程 → 配置 / 文件系统 / mpv / Spotify
```

不要把 README 当作全部功能的事实来源。当前代码还包含 Spotify OAuth 与录音匹配、AMLL 远程 TTML 检索、DeepSeek 翻译；Spotify 在这里用于辅助识别歌曲，不承担在线音乐播放。现有 `useResolvedLyrics` 会在符合条件时发起 AMLL 查询，因此「离线优先」不等于「绝不联网」。

## 2. 代码阅读地图

以下路径相对于仓库根目录。

| 职责 | 核心文件 | 应理解的重点 |
| --- | --- | --- |
| 启动与路由 | `src/index.tsx`、`src/App.tsx` | 初始化顺序、全局组件、独立 Studio 路由 |
| 状态 | `src/store/store.ts`、`src/store/slices/*` | UI 状态与实际媒体资源分离 |
| 导入 | `src/library/importFiles.ts`、`metadata.ts`、`metadata.worker.ts` | 内容去重、标签回退、封面与歌词提取 |
| 曲库持久化 | `src/library/database.ts` | 原子提交、稳定 ID、并发更新、删除关联数据 |
| 文件夹 / 专辑 | `src/library/folderImport.ts`、`albums.ts` | 扫描历史、授权、保守分组 |
| 播放状态机 | `src/player/LocalAudioPlayer.ts`、`queue.ts` | 命令与事件竞态、错误分类、随机与循环 |
| 播放协调 | `src/player/runtime.ts` | 单例资源所有权、提交后发布 UI、串行写操作 |
| 原生输出 | `src/player/nativeAudio.ts`、`audioOutput.ts`、`electron/native-audio*.mjs` | 输出切换、状态桥接、命令版本、设备故障 |
| 恢复 / 统计 / 增益 | `playbackMemory.ts`、`listening*.ts`、`normalization*.ts` | 保存频率、实际听歌时长、峰值安全增益 |
| 歌词入口 | `src/lyrics/parse.ts`、`types.ts`、`repository.ts` | 当前 TTML 主路径与 revision 校验 |
| 歌词渲染 | `audioClock.ts`、`timeline.ts`、`useLyricFrame.ts`、`src/components/Lyrics/LyricsView.tsx` | 单音频时钟、多声部、逐字进度与跟随 |
| 远程歌词 | `src/lyrics/amll.ts`、`amllMatch.ts`、`electron/spotify.mjs` | 匹配歧义、取消、下载限额、回退 |
| 翻译与导出 | `src/lyrics/translate.ts`、`serialize.ts`、`lyricImage.ts` | 结果逐行校验、时序保留、图片生成 |
| 分析 | `src/analysis/sources.ts`、`tasks.ts`、`versions.ts`、各 `repository.ts` | 来源版本、任务状态、缓存有效性 |
| 本地音频分析 | `src/analysis/audio/*`、`src/analysis/loudness/*` | 解码预算、采样率、算法生命周期 |
| 桌面壳 | `electron/app.mjs`、`preload.cjs`、`policy.mjs`、`storage.mjs` | 固定 origin、权限边界、目录迁移 |
| 构建与验证 | `package.json`、`electron-builder.yml`、`scripts/*`、`tests/*` | 当前 Windows 构建限制与测试基线 |

## 3. 启动、状态与存储

### 3.1 启动顺序

`src/index.tsx` 先取得全局音频元素并接入诊断，初始化诊断、DeepSeek 配置、主题、语言、字体等服务；异步恢复曲库，成功后再初始化文件夹自动导入和音频输出。React 使用 StrictMode，播放器生命周期不依附于页面挂载。

`App.tsx` 提供主题、Redux Provider、BrowserRouter、全局拖放导入和设置。曲库、搜索、专辑、歌词和 Analyze 复用主布局；`/studio` 独立于主布局，Studio 与 Analyze 使用懒加载。

Redux 存歌曲描述、队列、播放状态和 UI 设置；音频 Blob、对象 URL、Audio 元素、Worker、取消控制器保留在服务层。这样避免不可序列化资源被组件重复创建，也让路由切换不会打断播放。

### 3.2 数据结构与事务

`database.ts` 打开 `local-music-library`，当前数据库版本为 6：

| Object store | 内容 |
| --- | --- |
| `tracks` | 歌曲标签、技术信息、版本、历史与导入身份 |
| `audio` | 以 trackId 为键的音频副本 Blob |
| `covers` | 封面 Blob |
| `lyrics` | 原始歌词、解析结果、来源、候选格式、偏移和 revision |
| `playlists` | 播放列表及歌曲 ID 引用 |
| `settings` | 播放 / 外观 / 列宽 / 文件夹历史，以及现有 Studio 草稿等 |
| `analysis` | 算法结果及输入版本 |
| `analysis-edits` | 分析的人工编辑数据 |
| `analysis-tasks` | 任务状态 |

新歌曲使用 UUID；旧记录仍可能使用历史文件描述组成的 ID，升级不会重写其主键和外键。`importHash` 建立唯一索引，降低多窗口同时导入相同内容的风险。

`saveTracks` 将新歌曲、音频、封面、歌词放在一个事务中；以 `tx.oncomplete` 为成功条件。普通更新通过 `patchExistingTracks` 在同一事务内读取最新记录、检查 expected 值、只修改白名单字段，避免时长或历史的迟到更新覆盖人工编辑。最近播放时间取较大值，metadata 变化更新 revision。

删除歌曲会清理音频、封面、歌词、分析与任务，并从播放列表删除引用。歌词保存会在同一事务中核对歌曲是否仍然存在；下载结果可以携带预期 lyric revision，不能覆盖下载期间刚被用户修改的歌词。

`localStorage` 还承担播放位置、听歌统计与 Studio 应急恢复等小数据。Electron 的部分偏好使用 `configPreference` 读取主进程配置，不能认为全部设置都只在 IndexedDB 内。

## 4. 导入与曲库组织的完整流程

### 4.1 导入音频

```text
文件选择 / 拖放 / 文件夹扫描
  → runtime.operation 等待曲库就绪并串行执行
  → collectFiles 校验扩展名及非空文件
  → 内容指纹与必要的逐块字节比较
  → 新建稳定 UUID
  → Worker 读取标签、时长、封面、技术信息、内嵌歌词
  → saveTracks 原子提交
  → 注册音频 Blob、生成对象 URL、更新 Redux 与队列
```

导入白名单包括 MP3、WAV、FLAC、M4A、AAC、OGG / OGA、Opus、AIFF / AIF、WebM。通过扩展名筛选不保证对应平台一定能解码。

`fileFingerprint` 仅是名称、大小、修改时间组成的候选描述，不能证明相同内容。`fileContentHash` 对每个 1 MiB 块求 SHA-256，再对含长度和块摘要的 manifest 求摘要，最终带 `chunks-v1:` 前缀；**它不是整文件 SHA-256**。迁移实现必须保留这个定义或显式做哈希版本转换。

`collectFiles` 使用导入 hash 查找重复；必要时按大小筛选并调用 `sameFileBytes` 逐块比较，块间让出执行权。内容相同但改名的文件可识别为重复；同名同大小但字节不同的文件仍可导入。缺失音频副本的记录不应阻止补回有效文件。

元数据读取在独立 Worker 内调用 `music-metadata.parseBlob`，有 20 秒超时。封面优先选可解码的 front cover，并限制类型和大小；标签失败回退文件名，封面失败使用占位图，不直接丢弃整首歌曲。内嵌 TTML 与 LRC 同时存在时通常以 TTML 为主、保留另一种格式；发现内嵌歌词不会无条件覆盖手动导入歌词。

### 4.2 曲库恢复与资源管理

`initializeLibrary` 恢复元数据、音频、封面、播放列表和偏好，检查音频非空、大小一致及首尾可读性；缺失副本标记 `unavailable`。封面损坏不会使音频失效。新建对象 URL 后加入播放器，恢复上次歌曲和位置，后台补齐缺失时长、内嵌歌词与技术信息。

当前实现一次读取所有保存的音频 Blob，便于使用但不是面向超大曲库的最终结构。原生版建议元数据分页、音频按需打开、封面使用有预算的缓存，避免恢复时遍历并解码所有封面。

### 4.3 文件夹、专辑和重复清理

Web 文件夹导入依赖 File System Access 能力并保存目录 handle；启动时检查授权。Electron 主进程扫描用户选择的目录，提供临时受控 `localmusic://app/__folder/...` 地址，渲染进程分批读取并交回同一导入流程。自动导入单文件上限为 512 MiB。扫描历史区分相对路径、文件描述，只在成功保存后记为已见；不是持续实时文件监听，默认启动时扫描。

专辑按人工分组，或正规化后的专辑名、albumArtist / compilation / artist 与年份组合分组。未知专辑或身份不足时使用 trackId 隔离，避免把所有 Unknown Album 混成一个专辑；专辑内部按碟号、曲号排序，封面优先使用内嵌正面图。

重复清理与导入去重是两件事。现有清理支持预览、确认合并和恢复最近合并，还保护正在播放的歌曲及有 Studio 草稿 / 恢复副本的歌曲。macOS 迁移后继续保留全部 Studio 草稿保护；iOS 保留播放与数据冲突保护并解除 Studio 专属服务依赖，具体见第 10 节。

## 5. 播放实现与时间基准

### 5.1 单例播放器及队列

`runtime.ts` 是唯一音频元素的所有者，创建隐藏的 `new Audio()`，构造 `LocalAudioPlayer`，绑定状态回调、时长回写、最近播放历史、记忆、听歌统计与增益。页面只能取这个实例，不能为全屏、迷你歌词或 Analyze 再创建一份播放音源。

播放器状态包含 currentId、queue、status、position、duration、volume、shuffle、repeat、error。基本转换：

```text
idle → cue → paused
idle / paused / ended → play → loading → playing
playing → pause → paused
playing → ended → 循环当前 / 下一首 / ended
loading / playing → 媒体故障 → error → 必要时跳下一首
loading / playing → 输出设备故障 → error，保留歌曲与位置
```

切歌时先增加命令版本、停旧源、发布新歌曲，再替换 src、load，按需 play。音频事件检查 currentSrc 与当前歌曲 URL，异步 play 完成后也检查命令版本，防止旧歌曲的回调覆盖新状态。15 秒加载 watchdog 要求音源可用且时钟实际前进，不能把无声卡住当成功。

随机模式保留原始队列，可恢复顺序；开启随机时把当前歌曲放在首位。循环依次为 off → all → one。媒体文件故障可加入 failed 集合并跳过，输出设备、后端等故障不能据此认定歌曲损坏。

### 5.2 两种桌面音频管线

默认路径仍是 HTMLAudioElement 的流式播放。`electron/audio-backend.mjs` 设置 Chromium 解码相关开关，让当前桌面构建使用其原生 FFmpeg 解码路径；它与单独的 mpv helper 是不同路径。注释里的 Chromium 版本结论只适用于已检查的构建，升级后需要重新验证。

选择原生设备时，`attachNativeAudio` 对同一音频元素包装属性和方法，将加载、播放、暂停、seek、音量、倍速交给 IPC / mpv，再转换回相同媒体事件。它使用 resourceId、generation、intent、seek sequence 防止迟到命令干扰当前意图，并用短时受限外推改善 UI 时钟连续性。

切换输出会记录时间、播放意图、音量和速度，重建目标管线，恢复位置；失败尝试回到旧输出。切换期间用户暂停或切歌优先于之前的快照。Windows helper 使用 `mpv.exe`、命名管道和 WASAPI；设备过滤、后端检查及独占模式均包含 Windows 假设。

### 5.3 记忆、听歌时长和增益

播放记忆仅存 trackId 和秒数，正常播放节流约 5 秒，暂停、结束、seek 或页面隐藏时强制保存；重启 cue 歌曲并等待 metadata 后定位，不自动恢复出声播放。保存失败提供重试，不把临时对象 URL 写入数据。

听歌时长同时参考媒体时间、单调时钟、墙上时间及倍速，处理暂停、seek、缓冲、切源和日期变化；正常约每分钟保存，暂停和离开时刷新。迁移到后台播放后，统计必须继续由原生服务负责，不能只在网页可见时累计。

响度归一化读取当前音频版本匹配的分析结果。请求增益为测量 gainDb 加 preampDb；开启峰值保护时上限为 `ceilingDbtp - 20 × log10(truePeak)`，最后转成线性增益。这是基于静态峰值的增益约束，不是实时压缩器。浏览器通过 GainNode 平滑变化，mpv 通过其立方音量曲线换算；原生 Apple 实现不能照搬 mpv 音量百分数。

## 6. 歌词解析、来源与显示

### 6.1 模型与真实入口

`LyricDocument` 是播放模型：format、timing、profile、lines、agents、notices。每行包含稳定 id、groupId、start / end、parts、lead / background、agent、section、翻译 / 罗马音 annotations；part 可带逐字时间和独立演唱者。

`SavedLyrics` 同时保存原始 source 与解析模型、parserVersion、来源、offsetMs、revision、alternates 和远程标识。原文必须保留：解析器升级可重算模型，未知属性或布局信息也不应因导入而不可恢复。

**当前 `parseLyrics` 的主路径：**

```text
.lrc → parseLrc
.ttml / .amll → importProjectTtml → projectToPlayer → LyricDocument
```

也就是说，当前 TTML 播放路径经过 Studio 的项目模型。仓库虽有 `src/lyrics/parseTtml.ts`，但不能根据文件名认定它是生产入口，也不能直接替换而假设行为一致。`LYRICS_PARSER_VERSION` 当前为 4。

### 6.2 时间规则与格式边界

LRC 支持多时间标签、metadata、offset 及 enhanced LRC 的词标签。普通行的结束时间取下一个更晚时间，空行时间标签可终止前一行。没有可靠 end 的词降级为行级高亮，不虚构逐字时长；跨越下一行的词时间会拒绝，显式重叠声部应使用 TTML。解析有 source、物理行、事件、词节点及 24 小时时间预算。

TTML 主路径解析 XML 命名空间、显式时段、相对或 Apple 绝对时间、多声部、演唱者、段落和注解；限制节点数量、深度、时长，拒绝 DTD / ENTITY、外部音视频资源、动画、非 media time 等不支持结构。有效的 Apple 背景声部可以比主唱段落更长，不能简单按主唱区间截断。跨平台解析要用语料回归核对这些语义。

两个偏移的符号要区分：LRC 文件 `[offset:+N]` 在解析时使时间减去 N 毫秒，即提前显示；应用保存的正 `offsetMs` 在渲染时令 `lyricTime = audioTime - offsetMs / 1000`，即延后显示。点击行跳转时反向转换为 `audioTime = line.start + offsetMs / 1000`。

### 6.3 时钟、逐字高亮和布局

`audioClock.ts` 从全局音频元素读取时间，所有歌词表面共用一个 requestAnimationFrame 调度。暂停、结束、页面隐藏时停帧，并通过媒体事件补采样。不能每次 interval 简单加一个固定步长，否则 seek、倍速和缓冲会产生漂移。

`useLyricFrame` 用边界数组和二分定位减少 React 更新，只在活动区间、结束状态或时长改变时刷新行级状态。`lyricFrame` 保留所有同时活动声部，以 lead 为优先 focus；逐字高亮则只对活动行直接更新 CSS 变量。词逻辑进度为 `clamp((t-start)/(end-start), 0, 1)`，视觉层另有快速词、拖音等处理。

`LyricsView` 将同段主唱 / 和声分组，按多声部场景布局，支持翻译、演唱者标签和间奏。自动跟随由 `useLyricFollow` 管理；用户滚轮、触摸或键盘浏览时暂停跟随，并显示恢复按钮。主界面、迷你歌词和全屏共享来源与时钟，而不是分别选取歌词。

### 6.4 来源选择、AMLL 与 Spotify

本地文件 / 内嵌歌词保存到统一仓库，候选格式切换也修改同一个主记录。解析版本变化时使用原文重新解析。

AMLL 解析器先读取当前歌词：已有 TTML 主记录或候选时保持现状；否则尝试用已连接的 Spotify 得到 ISRC / Spotify ID，再查询 AMLL，或使用标题和歌手精确匹配。API 不可用或无结果时可以查询官方仓库索引；存在录音歧义时回退本地，不能用第一个模糊结果覆盖。

远程文件经过限额、标识一致性、格式和解析校验；保存时带请求开始前的 lyric revision，将原本歌词保留为 alternate。共享请求、取消控制器、短期任务缓存和索引过期机制减少重复请求，切歌后的旧结果不能覆盖新选择。

现有 Spotify 登录在 Electron 主进程使用 PKCE、state 与 `127.0.0.1:43821` loopback callback，令牌交给配置层保护。iOS 必须采用适合移动平台的授权回调，不能复制桌面本地服务器方案。是否默认开启远程匹配，建议在新平台作为明确的用户偏好；核心导入与播放应在网络不可用时继续工作。

### 6.5 翻译、导出与音频标签写入

DeepSeek 翻译按批发送歌词文本，校验返回 ID、一一对应数量、文本非空与完成状态，再为对应行加入 translation annotation。`serializeLyrics` 保留混合时序、多声部与 performer 信息，未定时的词不伪造时间。

图片导出依赖浏览器字体 / 排版 / 图形能力，原生版本可用 Core Text / 绘图服务重写，或暂时保留 Web 渲染；导出时必须等待字体准备完毕并验证尺寸和文字布局。

`writeAudioLyrics.ts` 支持 FLAC Vorbis comment、MP3 ID3v2.3 / v2.4 和 WAV ID3 chunk。它只重组标签与容器，音频数据通过 Blob slice 保留，不解码重编码；拒绝不能安全处理的标签 flags、索引、签名或损坏结构。写入后通过事务验证音频和歌词版本，替换的是应用副本，保留偏移。此能力可以独立于 Studio 保留，但新平台应先实现歌词文件导出，再考虑标签写入。

## 7. 分析逻辑

### 7.1 输入版本与任务

`readAnalysisSources` 当前读取已保存歌词和 Studio 草稿，生成歌词文字 fingerprint、metadata fingerprint、各音频版本；`readAudio` 再检查歌曲仍存在且版本未变化。分析结果包含 schemaVersion、算法版本、参数、时间、实际输入版本，修改音频或歌词后应显示结果失效。

DeepSeek 通用任务服务与本地音频队列分别管理运行。取消或失败保留旧结果；只有完整、有效的结果才保存。音频队列串行处理解码和计算，避免多个完整 PCM 同时占据内存；无法立即取消的浏览器解码要等其释放资源，再处理下一个任务。

### 7.2 BPM 与 Key

```text
读取应用音频副本
  → metadata 校验预算
  → OfflineAudioContext 完整解码
  → 检查实际时长 / 帧数 / 声道
  → 转 44,100 Hz 单声道分析输入
  → transferable PCM 交给 Worker
  → Essentia WASM RhythmExtractor2013 / KeyExtractor
  → 输出估计或 unreliable
  → 检查任务与版本，保存
```

当前通用预算为文件 160 MiB、PCM 192 MiB、时长 15 分钟、单声道或立体声。解码时长与标签时长不符会拒绝，不能把局部解码报告为全曲。静音或不足 3 秒直接输出不可靠结果；BPM / Key 也检查算法输出有效性，confidence / strength 不能包装成确定事实。Worker 超时约 5 分钟，结束后清理 WASM vector 与引擎。

### 7.3 响度与 ReplayGain

响度采用本地 TypeScript 测量实现，**不是直接使用 Essentia 的 BPM / Key 管线**。保留原声道、原采样率，不走单声道 44.1 kHz 重采样；PCM 限额 128 MiB，测量支持 44.1–192 kHz 的 mono / stereo。

实现包含 R128 K-weighting、momentary / short-term 窗口、门限处理、Integrated LUFS、LRA、sample peak 与 4 倍插值 true peak；当前 ReplayGain 2.0 目标为 -18 LUFS。持久化结果记录算法参数与来源时基；静音等不可测量情况不能生成可用增益。当前产品归一化仅 track 模式，不应把内部 scope 类型误读为已完成专辑响度归一化。

### 7.4 DeepSeek 歌词分析

用户配置并主动执行后，将选中的歌词文本发给 `https://api.deepseek.com/chat/completions`。当前限制 1,500 行 / 80,000 字符，超时约两分钟；只允许完整 JSON 回复，校验主题证据与实际歌词行、六类内容判断，标注为文本解读和 AI 评估，不能宣称确认作者意图。

迁移保留文字 / 音频分析隔离。歌词翻译和解读的在线调用不能成为导入、播放的前置条件；API Key 放入 Keychain，日志脱敏，任务取消后不能迟到保存。

## 8. Electron 桌面实现的边界

`app.mjs` 在 ready 前注册安全的 `localmusic://app/` scheme，该稳定 origin 也拥有 IndexedDB。资源路由检查路径穿越，SPA 页面回到 index；目录导入使用另一条受控资源路径。

窗口禁用 nodeIntegration，启用 contextIsolation 与 sandbox；preload 仅暴露固定操作，主进程核验调用者与参数。`policy.mjs` 限制导航、网络、下载和权限：明确允许 DeepSeek、AMLL API 与指定歌词仓库路径，不能随迁移放开任意 origin 或任意本地路径。

数据目录与缓存目录分开，固定 controlRoot 保存目录配置及实例锁；换目录在下一次启动、Chromium 打开数据库之前执行复制与校验，而非运行时移动已打开的 IndexedDB。配置包含凭证保护，日志有等级和脱敏，字体作为应用导入资源管理。

目前构建脚本明确指定 `--win --x64`，builder 配置为 Windows Portable，资源只有 Windows mpv 和 DLL，图标生成只准备 ICO / PNG。这些都是 macOS 迁移需要改造的实际入口。

## 9. 平台路线选择

建议分两步：先用现有 Electron 做 macOS 桌面版，快速复用 UI 与业务；iOS 使用原生文件存储和音频核心，再选择 SwiftUI 或 WKWebView 展示。若最终希望两个 Apple 平台均采用 SwiftUI，可在 macOS 首版稳定后逐步替换桌面 UI。

| 路线 | 能复用什么 | 必须做什么 | 适用阶段 |
| --- | --- | --- | --- |
| macOS Electron | 大部分 React、TS、IndexedDB、歌词 UI、分析 | 构建、生命周期、设备后端、权限、签名 | 最快提供桌面版 |
| SwiftUI macOS + iOS | 数据契约、算法语义、语料与测试；Swift 核心可共享 | 重写视图、存储、播放器和服务 | 长期原生产品 |
| 原生壳 + WKWebView | 提取后的 TS 歌词逻辑、部分 React 展示 | 原生音频 / 持久化 / 文件服务与桥接 | 过渡复用 |

Electron 不作为 iOS 运行时。WKWebView 路线也应由原生层拥有播放、队列和音频文件；WebView 在后台可能停止刷新，不能让其 RAF 或 JS 定时器承担后台播放状态机。

原生 Apple 核心建议模块：LibraryRepository、FileImportService、PlaybackService、LyricsRepository、LyricsParser、LyricTimeline、AnalysisService、PreferencesService、CredentialStore。共享层不依赖界面，平台层分别负责 macOS 和 iOS 系统能力。

## 10. Studio 平台边界：macOS 完整迁移，iOS 解除编辑器依赖

### 10.1 现有 Studio 的作用

Studio v2 项目使用整数毫秒和 null 未定时值，维护行、字 / 分隔符、演唱者、段落、翻译、边界和选择。文本编辑保留未改部分的 ID 与时间；打轴直接采样播放器；Undo / Redo 使用分组历史；保存先创建按歌曲隔离的应急副本，再提交 IndexedDB，成功后只清除对应恢复 revision。上述编辑、打轴录制、预览、工程保存 / 导出及恢复工作流全部纳入 macOS 迁移范围，仅在 iOS 版排除。这里的录制指采样播放时间完成打轴，不等同于麦克风录音。

### 10.2 iOS：保留歌词能力，移除编辑产品

以下拆分适用于 iOS 目标端。共享代码仍可服务 macOS Studio，不从现有仓库全局删除编辑器或草稿保护。

| 当前耦合 | iOS 迁移动作 | 验收条件 |
| --- | --- | --- |
| `parse.ts → studio/projectImport → playerAdapter` | 抽出只读 TTML 解析、时间范围推导、ID 和 namespace 处理到独立歌词核心；必要时保留最小中间模型 | 外部 TTML / AMLL 导入和旧 Studio 导出的 TTML 显示等价 |
| `projectImport` 依赖 `projectExport` 常量 / ID 解码 | 抽出共享 codec，而不是把工程导出器一起带过去 | 编码 ID、引用和重复 ID 校验不退化 |
| `playerAdapter → validation.lineBounds` | 将播放所需边界逻辑移到歌词核心 | 最后行、和声延长、混合时序正确 |
| `analysis/sources.ts` 读取草稿 | 仅从 SavedLyrics 及当前选定来源生成分析输入 | Analyze 不列出 Studio draft，也不依赖草稿库 |
| `runtime` / `duplicateCleanup` 检查 Studio 草稿和恢复 | 把现有保护拆为可选的遗留数据保护；新平台无 Studio 服务依赖 | 现有源数据仍安全，目标端重复处理正常 |
| 路由、菜单、曲目右键、Analyze 导航 | 删除 Studio 入口；「导入或编辑」改为实际可用的歌词导入管理 | 无死链和误导性打轴按钮 |
| Settings 中工程数据、恢复状态与诊断 | 不初始化 Studio journal，不显示相关 UI | 目标端不创建 Studio 恢复记录 |
| 转移包内草稿 | 可以归档为不解析的 legacy 文件，或明确列入未迁移清单 | 不静默丢弃用户工作，不让它阻塞目标端 |

外部 TTML 的 performer、翻译、和声、段落都是播放器需要的数据，并不因 iOS 移除 Studio 而删掉。已经在 Windows 或 macOS 制作并导出的 LRC / TTML 仍可作为普通歌词导入；iOS 不提供 Studio 工程 JSON 导入编辑能力，macOS 则保留工程导入和继续编辑。

不能简单启用旧 `parseTtml.ts` 代替生产路径。先用正常 / 异常语料对照当前入口，补齐 Apple 和声、身份引用、注解、边界等差异，再切换。原生重写也应遵循同一份解析契约。

### 10.3 macOS：完整 Studio 的迁移策略

Electron 首版直接复用 `src/pages/Studio`、`src/components/Studio` 和 `src/studio` 的项目模型、操作、打轴、预览、校验及持久化。保留整数毫秒与未定时 null 的区别、编辑分组历史、原始 TTML source 和 ID 引用，不把 StudioProject 简化成只读 LyricDocument 后再反向恢复工程。

需要逐项验证的桌面适配：

- **快捷键与焦点**：将 Undo / Redo、保存等常规操作适配 Cmd，保留行 / 字打轴专用按键；输入框、IME 组合输入、菜单快捷键与全局监听之间避免双重执行。空格播放不能打断正文输入。
- **共享播放与试听**：StudioTransport、预滚、片段循环、倍速与实时预览继续使用唯一播放器及权威音频时钟。切换原生输出后仍需验证 mark 时刻和 seek 结束事件，不为 Studio 新建第二个 audible 音源。
- **退出与恢复**：关闭 Studio 窗口、Cmd-Q、系统退出、Dock 重开均检查保存状态。恢复 journal 与 IndexedDB 提交保持原有顺序；迟到保存只能清除自己的恢复 revision。关闭最后窗口后若保留后台进程，明确停止或保留的试听意图，重开不重复初始化播放器。
- **工程与歌词导出**：保留工程 JSON、LRC、TTML、播放器同步与 MP3 / FLAC / WAV 应用副本标签写入；系统保存对话框取消不应被视为成功导出。外部文件权限结束后，应用副本仍可继续编辑和试听。
- **分析与重复保护**：Analyze 继续允许 Studio draft 来源并按文字 fingerprint 判定失效；重复合并继续保护带工程 / 恢复草稿的歌曲，曲库删除与工程关联清理维持一致。
- **布局与字体**：验证 Retina、不同窗口尺寸、分栏拖动、全屏、系统字体和自定义字体回退；编辑行选择、逐字片段与实时预览的时序不因字体重排改变。

若后续把 macOS UI 改成 SwiftUI，StudioProject 的 Codable 对应模型、分词与 grapheme 边界、编辑命令、分组 Undo / Redo、毫秒打轴、预滚 / 循环、原始 source 保留、工程校验及恢复 journal 都需原生实现。可以先将完整编辑器留在 WKWebView 并桥接同一原生 PlaybackService，再逐步替换视图；共享 iOS 播放核心不要求 iOS 暴露编辑器。macOS Studio 的原生改写是独立迁移工作，不能用只读歌词显示完成来代替。

## 11. macOS 迁移实施方案

### 11.1 首版：Electron + 默认媒体输出

1. 保持现有 `localmusic://app/` origin，保留 `/studio`、菜单、曲目右键和 Analyze 的 Studio 入口；为 iOS 抽离共享 TTML 核心时，确保 macOS 的编辑与播放行为保持一致。
2. 新增 macOS 构建命令和 builder target，准备 ICNS；分别验证 arm64 / x64。现有打包、尺寸检查及 Windows fixture 脚本需要按平台分支。
3. macOS 首版不注册 Windows mpv 服务。`window.localMusicDesktop` 的 native 方法改为按能力暴露，输出初始化不识别旧 `wasapi/...` 值，失效偏好归回默认输出。
4. 验证 Chromium 版本下所需格式、seek、倍速、增益和歌词时钟；Windows 验证过的解码 flags 不能作为 macOS 正确性的证据。
5. 改造窗口生命周期：关闭最后窗口和退出应用分离，处理 activate、Dock 重开、系统退出、菜单快捷键及 Cmd 键。现有 `window-all-closed → app.quit()` 不应原样保留。
6. 默认数据置于系统 Application Support，缓存置于 Caches；保持 control / data / cache 分工，移除 LOCALAPPDATA 等 Windows 假设。导出使用系统保存对话框。

### 11.2 后续：原生设备输出

可以继续使用 macOS mpv helper，改为 CoreAudio 输出和 Unix domain socket，替换命名管道、exe 路径、设备过滤、WASAPI 检查和错误映射；每个架构单独提供正确二进制，审核其动态库依赖和签名。mpv 设备独占 / hog 行为需以 macOS 和实际设备验证，不能照搬 Windows exclusive 设置。

如果希望最终与 iOS 共享播放器，优先原型验证 AVPlayer 或 AVAudioEngine。AVPlayer 适合系统媒体播放；当需要可控 DSP 增益、PCM 调度或更精细输出处理时评估 AVAudioEngine。其解码格式、时间准确度、长文件流式调度、倍速保音高及功耗必须实测后确定，不能只根据 API 名称承诺全格式支持。

Apple 后端要提供「加载 / 播放 / 暂停 / 定位 / 状态快照」契约，保留 generation、intent、seek token 与错误类型；前端不需要了解具体 CoreAudio 设备实现。

### 11.3 文件权限与分发

沙盒环境下，通过系统选择器获取用户授权，持久访问外部目录使用 security-scoped bookmark，解析时检查 stale，读写前后配对 start / stop accessing。若仅导入复制到应用容器，完成复制后即可结束原文件访问。[Apple NSURL 文档](https://developer.apple.com/documentation/Foundation/NSURL)

建议先提供 Developer ID 签名和公证的站外 macOS 包；签名范围覆盖 helper 和嵌套动态库，在干净机器验证 Gatekeeper。Mac App Store 是单独路径，需要 MAS Electron、App Sandbox 和权限配置，不能把站外构建直接当 MAS 构建。[Apple 分发签名](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/)、[Electron MAS 指南](https://github.com/electron/electron/blob/main/docs/tutorial/mac-app-store-submission-guide.md)

## 12. iOS 迁移实施方案

### 12.1 文件与存储

使用 document picker / fileImporter、分享导入等系统入口，默认将音频复制到应用管理目录；保存 metadata 到 SQLite 或选定的原生数据库，封面和音频为按 trackId 组织的文件。Application Support 保存持久数据，Caches 保存可重建缓存。文件从 iCloud provider 导入时可能需要下载，必须处理取消、不可读和空间不足。

目录选择可由系统授予 security-scoped URL；保存授权也不能假定永远有效。扫描应在用户进入前台或主动要求时执行，不承诺应用挂起后仍实时监听任意目录。[Apple 目录访问文档](https://developer.apple.com/documentation/uikit/providing-access-to-directories)

默认复制可使离线播放不依赖外部授权或文件移动。若以后增加引用模式，需要单独实现 bookmark、失效恢复和云端下载状态，而不是简单保存绝对路径。

### 12.2 原生播放与后台生命周期

PlaybackService 在应用生命周期内唯一存在，视图退出时仅解除 UI 订阅。根据验证结果选择 AVPlayer，或可流式调度的 AVAudioEngine。队列、循环、随机、故障策略、状态保存都由原生服务拥有。

配置 AVAudioSession `.playback`，并设置后台音频模式，处理中断、route change、耳机拔出、蓝牙切换及媒体服务重置。耳机拔出等情况通常暂停并等待用户意图；中断结束后结合系统建议与原先播放意图决定是否恢复。[Apple playback category](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback)

接入 MPNowPlayingInfoCenter 和 MPRemoteCommandCenter，提供锁屏 / 控制中心的播放、暂停、上下首和定位；系统 elapsed time、rate、封面与实际引擎保持一致。界面重新进入前台时先拉取权威快照，不能从 WebView 暂停前的时间继续推算。

iOS 输出遵循系统路由，不复制 WASAPI 任意设备下拉框或桌面独占选项；展示当前路由并使用系统支持的路由选择。应用增益与硬件系统音量区分，归一化只在经过验证的 DSP 路径应用一次。

### 12.3 歌词渲染

原生 LyricsParser 产出与 LyricDocument 对应的 Codable 模型，时间用整数毫秒或明确时基，界面渲染时转换。保留主唱 / 和声 group、agent、part timing、annotations 和 source；Swift 字符串边界按可见字符处理，不能照搬 JS UTF-16 index。

播放器回调提供权威时间，前台显示通过 TimelineView / display link 等刷新机制采样；暂停、不可见时停止无效动画。行级状态只在边界变化时发布，活动行逐字动画局部刷新。原生列表还要实现用户浏览暂停跟随、恢复按钮、点击行定位、前奏 / 间奏和无歌词占位。

WKWebView 过渡版也使用原生时钟：低频发送时间锚、rate、状态、generation，前台 JS 做有限外推，并在 seek / 切歌 / 中断 / 前台恢复时立即校准。原生层不得每帧经桥传整份歌曲或歌词。

### 12.4 移动端界面与分析

iPhone 页面分为曲库、专辑、正在播放、歌词、分析、设置；底部迷你播放条进入完整播放页，歌词作为主要阅读界面。iPad 可以采用侧栏与双栏。桌面表格列宽、右键菜单、悬停操作、900×600 最小窗口等布局假设应重做，手势、Dynamic Type、VoiceOver、减少动态效果要一起验证。

本地分析先以前台主动任务提供，限制并发为 1，根据设备内存预算调低完整 PCM 限额，支持取消和低内存退出。原生可用分块解码降低峰值内存，但必须保证全曲统计和边界状态一致；若只扫描片段，应新建算法 / 结果标识，不能继续显示为 full-track。

BPM / Key 可评估 Essentia 原生构建或继续在前台 WebView 使用 WASM；不能认为现有 Worker 资产在 WKWebView 自动等价运行。响度计算可移植现有数学逻辑到 Swift / C++，用同一组 PCM 语料比对门限、窗口、滤波器、true peak。先完成播放和歌词，再推进音频分析。

在线分析 / 翻译通过 URLSession 或受限桥服务完成，凭证进入 Keychain。Spotify 用移动平台授权会话及已注册 callback 设计，保持 PKCE / state 校验；该可选能力不应阻塞首版。

## 13. 数据转移：设计显式导出包

**当前仓库没有本文所描述的统一跨平台迁移包实现。** 不建议直接把 Chromium profile / IndexedDB 文件夹作为原生导入格式：它绑定 origin、数据库实现和目录结构，也包含平台配置与凭证。

建议新增版本化迁移包：

```text
transfer-v1/
  manifest.json
  tracks.json
  playlists.json
  lyrics/<安全生成的资源键>.json
  media/<安全生成的资源键>.<实际格式>
  covers/<安全生成的资源键>.<实际格式>
  analysis/results.json
  preferences.json
  studio/projects/<安全生成的资源键>.json  # macOS 可恢复编辑；iOS 仅归档
  studio/recoveries/<安全生成的资源键>.json # 尚未成功保存的恢复草稿
```

manifest 记录 schemaVersion、应用版本、导出时间、资源长度与整文件 SHA-256 校验值、来源 ID 和资源路径映射。新包的整文件校验值应使用不同字段名，不能混同旧 `chunks-v1 importHash`。

源库可能含历史 JSON 形式 trackId，资源文件名必须通过新生成安全键映射，不能直接拼接 trackId。保留内部 trackId 字符串可维护播放列表和歌词引用；目标端发生同 ID 异内容时，生成新 ID，并用一次完整映射重写所有外键。

导出应形成一致快照，避免音频写入、删除或歌词更新期间生成相互矛盾的文件。大型音频分块写包，避免全部装入内存。包不包含 API Key、Spotify token、旧绝对路径、blob URL、Windows 输出设备、localStorage 全量副本。

目标端先检查包版本、路径穿越、文件长度、摘要、外键与数据预算，解包到暂存目录，再提交数据库。文件系统与 SQLite 不是同一个事务：需要导入 journal / manifest 来处理搬文件成功但数据库失败的恢复；成功前不发布曲库状态，不删除源数据。错误后清理暂存，允许重试。

分析结果只能在算法、参数、音频版本等契约兼容时继续有效；迁移或解析导致版本语义变化时，保留为历史结果并标记 stale。播放记忆可映射歌曲与位置后恢复为暂停；主题、语言、歌词字号可迁移，但字体文件需明确打包或使用系统回退。

macOS 导入 Studio v2 项目及恢复草稿，使用现有项目校验 / 旧版迁移逻辑；trackId 冲突时重写工程歌曲引用，保留项目内部行、字、performer 和 section 的身份关系。遇到目标端已有较新工程时不按导入顺序覆盖，保留冲突副本供选择。恢复草稿只有在持久保存成功后才能清除，不能导入后直接视为已保存。

iOS 不把 Studio 草稿转为可编辑项目，也不从未完成草稿悄悄生成播放歌词；迁移包可以保留不解析的归档，或在报告中明确列为未迁移项。需要播放的成果由 Windows / macOS 导出有效 LRC / TTML，再作为普通歌词迁移。两端导入报告必须分别列出工程恢复、冲突及归档状态。

## 14. 建议的核心服务契约

以下是新平台设计契约，不是已经存在的仓库 API。

```text
LibraryRepository
  list / get / import / patch(expectedRevision) / remove
  音频和封面按资源引用访问；提交后发布变更

PlaybackService
  load(trackId, generation) / play(intent) / pause(intent)
  seek(timeMs, seekToken) / setRate / setGain
  snapshot + 状态 / 错误事件

LyricsService
  parse(source, format, parserVersion)
  resolve(trackId) / save(expectedRevision) / setOffset
  document + 原文 + 来源 / alternate

AnalysisService
  enqueue(inputVersions, algorithm, settings)
  cancel(taskId) / progress / saveIfCurrent
```

原生服务采用 actor 或等价串行模型维护播放器和写操作，UI 状态在主线程发布。通过类型明确 milliseconds、seconds、dB、linear gain，避免 JSON number 看起来一样却被错误解释。

WKWebView 桥仅接受固定命令，校验来源、参数、消息大小、requestId 与资源归属，不暴露任意文件路径、执行脚本或网络代理。大文件走原生资源句柄 / 流式读取，不能在 JS 与 Swift 之间来回 base64 全曲。

## 15. 分阶段交付与验收

| 阶段 | 交付 | 完成条件 |
| --- | --- | --- |
| A：定义边界 | macOS Studio 保留清单、iOS 依赖拆分、数据 / 时间 / 错误契约、格式语料 | iOS 歌词核心不依赖编辑器，macOS Studio 行为和既有语料不退化 |
| B：macOS 首版 | Electron 构建、默认输出、导入 / 歌词 / 设置、完整 Studio、签名包 | 两种架构可启动，Studio 打轴 / 工程恢复 / 导出正常，无 Windows helper 调用 |
| C：数据桥 | 导出包、平台导入器、macOS 工程恢复、iOS 草稿归档及冲突报告 | 音频摘要和外键一致，macOS 可继续编辑工程，失败不破坏源库或目标库 |
| D：iOS 播放核心 | 文件导入、原生仓库、队列、后台、锁屏控制 | WebView / 页面退出不影响播放，中断与恢复正确 |
| E：iOS 歌词与 UI | LRC / TTML、多声部、偏移、逐字、全屏、设置 | 语料显示一致，seek / 倍速 / 前台恢复无持续漂移 |
| F：可选能力 | 在线匹配、翻译、歌词分析、BPM / Key / 响度、标签写副本 | 预算、取消、缓存失效、隐私和导出行为有验证 |

关键回归场景：

- 导入：重命名的相同文件、同名异内容、损坏标签、无封面、缺失副本、磁盘满、授权取消、并发导入。
- 播放：快速连切、加载时暂停、连续 seek、队列删当前歌曲、随机恢复顺序、坏文件跳过、设备失效保留歌曲。
- 歌词：普通 / enhanced LRC、文件 offset 与应用 offset、混合时序、同起点、和声超出主唱、演唱者、翻译、最后行结束时间、异常 XML。
- 时钟：0.5 / 1 / 1.5 倍速、seek 后活动行、前后台切换、屏幕锁定、蓝牙连接变化、多个显示表面一致。
- 分析：静音、短音频、不同采样率、mono / stereo、超预算、取消解码、迟到结果、替换音频后 stale。
- macOS Studio：行 / 字打轴、多声部、预滚与循环试听、倍速、Undo / Redo、文本输入焦点、Cmd 快捷键、工程导入 / 导出、关闭窗口时未保存保护、恢复副本不覆盖较新项目。
- 数据：导出时并发写入、摘要错误、路径穿越、ID 冲突、缺资源、导入中断与重试、macOS Studio 工程恢复及 iOS 排除 / 归档报告。

现有单元测试可作为语义基线：`tests/import-ids.test.ts`、`library.test.ts`、`player.test.ts`、`lyrics.test.ts`、`ttml` / vocal 相关测试、`audio-tags-write.test.ts`、`loudness.test.ts`、`playback-memory.test.ts`、`listening-time.test.ts` 等。Studio 测试中覆盖 TTML 身份 / 声部解析的语料应提取到共享歌词核心测试；编辑器交互、工程与 recovery 测试纳入 macOS 验收，iOS 仅验证解析语义与工程排除边界。

项目命令包括 `npm run typecheck`、`npm test`、`npm run build` 及 browser / lyrics / analysis / loudness / desktop 等脚本。`npm test` 当前仅覆盖 `*.test.ts`，不自动执行全部 `*.test.mjs` 和浏览器测试。Apple 后台音频、权限、签名、锁屏与内存必须追加真机 / 实际 macOS 包验证，不能仅靠浏览器测试通过。

## 16. 依赖与技术决策记录

原仓库包含上游 MIT 声明，Essentia.js 附带 AGPL-3.0 许可证，当前 mpv helper 附带 GPL 与依赖声明；字体也有各自许可证。迁移时需要按实际分发依赖审核许可证、保留通知及所需源码交付，不能因为更换 UI 或独立 helper 就自动假定许可义务消失。若更换算法库，则使用新算法 ID / version 并验证误差，而不是保留旧结果身份。许可证材料见 `LICENSE`、`public/licenses/` 和 `desktop/native/`。

首轮需通过原型确定的事项：目标最低 macOS / iOS 版本、两种 Mac 架构范围、各音频格式的实际解码支持、SwiftUI 与 WKWebView 路线、是否需要 macOS 独占输出、移动端分析内存预算、站外发布还是 MAS，以及远程歌词默认行为。它们是待决策项，不应被本文当作已经验证的能力。

整个迁移的核心是保留「稳定歌曲身份 → 自有音频副本 → 权威播放时钟 → 统一歌词模型 → 带版本的原子保存与分析」，重写平台相关的存储、权限、后台与输出能力。macOS 保留完整 Studio 产品及其数据保护；iOS 移除编辑器前，先独立出 Studio 当前承载的只读 TTML 解析能力。
