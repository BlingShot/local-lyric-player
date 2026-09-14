// English source keys keep existing projects, metadata and lyrics independent of UI language.
const pairs = `
Language|语言
Interface language|界面语言
English|English
Settings|设置
Appearance|外观
Theme|主题
App theme|应用主题
Day|日间
Night|夜间
Liquid glass|液态玻璃
Listening time|听歌时长
Today|今日
All time|累计
Today listening time|今日听歌时长
Total listening time|累计听歌时长
Actual playback time, excluding pauses, seeking and buffering. Playback speed does not multiply listening time.|统计实际听歌时长，不计暂停、跳转和缓冲。播放倍速不会放大听歌时长。
Lyric Studio|歌词工作室
TTML Studio|TTML 工作室
LRC|LRC
Back to player|返回播放器
Back to library|返回曲库
Home|主页
Search local music|搜索本地音乐
Import music|导入音乐
All music|全部音乐
Albums|专辑
Your library|你的曲库
Local library|本地曲库
Local tracks|本地歌曲
Local albums|本地专辑
Albums from your music tags|根据歌曲标签整理专辑
Saved tracks|已保存的歌曲
Recently played|最近播放
Recently played tracks|最近播放的歌曲
Library view|曲库视图
Your library is empty|曲库为空
Import music from your device to start your collection.|从设备导入音乐，建立你的曲库。
Choose or drop music files from your device to start listening.|选择或拖入本地音乐文件，开始聆听。
Your queue is empty. Import music to get started.|播放队列为空，请先导入音乐。
Play a song to start your local history.|撤放歌曲后，这里会显示收听记录。
No matching files|没有匹配的文件
Search by title, artist, album or file name.|按歌曲名、艺术家、专辑或文件名搜索。
No local albums yet|暂无本地专辑
Import music to build albums from its embedded tags.|导入音乐后，根据文件标签建立专辑、
Album not found|找不到专辑
It may have been removed or regrouped.|专辑可能已移除或重新归类。
Album|专辑
Artist|艺术家
Title|标题
Duration|时长
Disc / Track|碟片 / 曲目
Disc|碟片
Track|曲目
Track number|曲目序号
Disc number|碟片序号
Album artist|专辑艺术家
Album artist:|专辑艺术家：
Unknown artist|未知艺术家
Unknown album|未知专辑
Not tagged|未标注
Date not tagged|未标注日期
Local file|本地文件
Local audio|本地音频
files|个文件
{0} files|{0} 个文件
{0} lines|{0} 行
albums ·|张专辑 ·
imported tracks|首已导入歌曲
Sort by|排序方式
Sort tracks by|歌曲排序
Import order|导入顺序
Sort ascending|升序排列
Sort descending|降序排列
Ascending|升序
Descending|降序
Group by album|按专辑分组
Keep each album together in disc / track order|同专辑歌曲按碟片及曲目顺序排列
File details|文件详情
File details panel|文件详情侧栏
Track info|歌曲信息
Bitrate|码率
Sample rate|采样率
Bit depth|位深
Not available in file metadata|文件元数据中没有此信息
Duration unavailable|无法读取时长
Reading duration…|正在读取时长…
Duration not loaded|尚未读取时长
Analyze|分析
Audio analysis|音频分析
Lyrics Insights|歌词解读
Meaning|含义
Themes|主题
Moods|情绪
Content Advisory|内容提示
Content notice|内容提示
All clear|未发现内容问题
Content review unavailable|内容检查不可用
AI assessment, not an official content rating|AI 判断，并非官方内容分级
Emotions expressed in the lyrics, not audio analysis|仅描述歌词情绪，未分析音频。
No text analysis yet. Melody and arrangement are not analyzed here.|暂无文本分析；此处不分析旋律和编曲。
No themes supplied by the analyzer.|分析器未提供主题。
Theme evidence will link to the original lyric lines.|主题依据将链接到原文歌词。
Expand|展开
Collapse|收起
Expand themes|展开主题
Show all {0} themes|显示全部 {0} 个主题
Show less|收起
Analyze lyrics|分析歌词
Analyze again|重新分析
Configure DeepSeek|配置 DeepSeek
Configured locally|已在本地配置
Not configured|尚未配置
Planned|待实现
Run analysis|开始分析
Run again|重新运行
Cancel|取消
Complete|已完成
Not analyzed|未分析
Not analyzed yet.|尚未分析。
Force reanalyze|强制重新分析
Analyze BPM & Key|分析 BPM 和调性
Analyze BPM|分析 BPM
Analyze Key|分析调性
Analyze track loudness|分析单曲响度
BPM|BPM
Key|调性
ReplayGain & Loudness|ReplayGain 与响度
ReplayGain and loudness analysis|ReplayGain 与响度分析
Integrated Loudness|综合响度
Loudness Range|响度范围
True Peak|真峰值
True peak|真峰值
Sample peak|采样峰值
Track Gain|单曲增益
Estimated tempo · BPM|估衡速度 · BPM
Estimated full-track key|全曲调性估计
Key-profile match strength:|调性模板匹配强度：
Beat confidence (raw score):|节拍置信指标（原型评分），
Edit BPM|保改 BPM
Edit Key|修改调性
Manual BPM|手动 BPM
Reset to original|恢复算法原始值
Algorithm original:|算法原始值：
Manual correction|手动修正
Tonic|主音
Mode|调式
Major|大调
Minor|小调
major|大调
minor|小调
BPM tag|文件 BPM 标的
Key tag|文件调性标签
Embedded file tags|文件内嵌标的
Source: existing file tags. These values are separate from this player's analysis and do not change playback gain.|来源：文件已有标签。这些数值独立于播放器分析结果，不改变播放增益。
ReplayGain Track Gain|ReplayGain 单曲增益
ReplayGain Album Gain|ReplayGain 专辑增益
Track / Album peak tags|单曲 / 专辑峰值标签
Analysis details|分析详情
Measurement details|测量详情
Saved analysis details|已保存的分析详情
Algorithm|算法
Standard|标准
Analyzed|分析时间
Target settings|目标设置
No target settings supplied by the analyzer|分析引擎有提供目标设置
Results are never rerun automatically.|不会自动重新执行分析。
Selected lyric text is sent to DeepSeek when you analyze. Results are AI interpretations of lyrics only.|点击分析时，会将选中的歌词文本发送给 DeepSeek。结果仅为 AI 对歌词的解读。
This saved result has no complete category review. Analyze again to update it.|旧结果没有完整的分类检查，请重新分析。
The previous task was interrupted when the player closed. Run it again to continue.|上模任务因播放器关闭而中文，请重新运行。
The previous scan was interrupted. Run it again to continue.|上模扫描已中文，请重新运行。
The audio or analysis parameters changed. Review the saved result and corrections, or analyze again.|音逑或分析参数已改变，请检查已有结果和信正值，或重新分析。
Audio or analysis settings changed. Reanalyze before using this result for playback.|音逑或分析设置已改变，重新分析后才能将结果用于播放。
Reading local inputs…|正在读取本地数据…
Song unavailable|歌曲不可用
This song is no longer in your library. Analysis is linked to its record, not its title.|该歌曲已不在曲库为。分析结果关联歌曲记录，而非歌曲名称。
No lyrics for this song. Import or edit lyrics in Lyric Studio first.|这首歌曲没有歌词，请先在歌词工作室导入或编辑、
Open lyrics in Studio|在工作室打开歌词
Import or edit lyrics|导入或编辑歌词
Lyric source|歌词来源
Imported / embedded lyrics|导入 / 内嵌歌词
Lyric Studio draft|歌词工作室草程
DeepSeek|DeepSeek
DeepSeek API key|DeepSeek API 密钥
DeepSeek model|DeepSeek 模型
API key|API 密钥
Enter your API key|输入 API 密钥
Model|模型
Analysis language|分析语言
Save settings|保存设置
Clear key|清除密钥
The key is encrypted for your Windows account and restored on startup.|密钥使用当前 Windows 账户加密，启动时恢名。
Analyze selected lyrics online. Audio and covers stay on this device.|在线分析所选歌词，音逑和封面保留在本机。
Requests run only when you click Analyze.|仅在点击分析时发送请求。
Browser mode keeps the key only for this session. Use the desktop app to save it in config.json.|浏览器仅在有次会话保留密钥；桌面版可保存到 config.json。
Auto import folder|自动导入文件夹
Choose folder|选择文件夹
Change folder|更换文件夹
Scan now|立即扫描
Disconnect folder|断开文件夹
Allow folder access|允许访问文件夹
Checks for new audio once on startup, including subfolders. Use Scan now to check again.|每模启动检查一次新增音频，包含子文件夹。需要再次检查时点击立即所描。
Folder auto import is unavailable in this browser. Use Import music to choose files.|当前浏览器不支持自动导入文件夹，请使用导入音乐选择文件。
Storage|存储
Database & audio|数据库与音频
Cache|缓存
Clear cache|清除缓存
Open folder|打开文件夹
Refresh usage|刷新占用情况
Reading storage usage…|正在读取存储占用…
Saved outside the executable. Audio copies, lyrics, Studio drafts, analysis and settings stay in your data folder.|数据保存在可执行文件之外。音频副本、歌词、工作室草稿、分析结果和设置存放于数据文件夹。
New cache location|新的缓存位置
New data location|新的数据位置
Apply on restart|重启时应用
Apply and restart|应用并重名
Cancel changes|取消更改
Change|更改
Config:|配置文件：
App memory:|应用内存，
Previous data backup (also uses disk space)|旧数据备份（也占用磁盘空间，
Previous storage locations ·|历史存储位置 ·
Data backup|数据备份
Previous cache|旧缓存
Open previous data folder|打开旧数据文件大
After checking your restored library, you can remove this old folder yourself.|确认曲库恢复完整后，可自行删除此旧文件夹。
These old folders were kept, not duplicated on every launch. Remove them yourself when no longer needed.|这些是保留的旧文件夹，并非每模启动都复制。不再需要时可自行删除。
HTTP cache limit: 128 MB. Code and graphics caches are stored separately here and can be regenerated.|HTTP 缓存上限为 128 MB。代码与图形缓存狀立保存在这里，可重新生成。
Playback will stop. On the next launch, the library is copied and verified before it opens. Large libraries may take a while. The old data folder is kept as a backup.|撤放将停法。下次启动时会先复制并校验曲库，大型曲库可能需要一些时间。旧数据文件夹将作为备份保留。
Volume normalization|音量均衡
Use measured ReplayGain|使用测量的 ReplayGain
Preamp|前级增益
Prevent clipping|防欢削法
True-peak ceiling|真峰值上除
ReplayGain 2.0 · −18 LUFS reference. Missing or stale results use no gain.|ReplayGain 2.0 · 参考响度 ∀18 LUFS。结果缺失或失效时不应用增益。
Lyric appearance|歌词外观
Show Performer / Background vocal labels|显示演唱者 / 背景人声标的
Show vocal labels|显示人声标的
Font|字体
Font size|字号
Line spacing|行距
Lyric font|歌词字体
Lyric font size|歌词字号
Lyric line spacing|歌词行距
System Bold|系统粗体
Arial Bold|Arial 粗体
DM Sans Bold|DM Sans 粗体
Font size stays fixed. Long lines wrap when needed. Missing glyphs use local bold fallback fonts.|字号保持固定，长句按需换行。缺少的字形使用有地粗体回退字体。
Reset lyric appearance|重置歌词外这
Lyrics timing|歌词时间偏移
Lyric fragments|歌词片文
No track selected|未选择歌曲
Play|播放
Pause|暂停
Previous|上一首
Next|下一首
Shuffle|随机播放
Repeat: {0}|得现：{0}
Volume|音量
Playback queue|播放队列
Playback controls|播放控制
Playback progress|播放进度
Playback speed|播放速度
Current track|当前歌曲
Player|播放器
Music player|音乐播放器
Studio player|工作室播放器
Speed|速度
Lyrics|歌词
Lyrics page|歌词页面
Open lyrics|打开歌词
Resume following|恢复跟随
Resume preview|恢名预览跟随
Full screen lyrics|全屏歌词
Exit full screen|退出全屏
Exit full screen (Esc)|退出全屏（Esc，
Instrumental break|间偏
Studio instrumental break|工作室间套
Preview instrumental break|预览间套
Background vocals|背景人声
Background · |背景人声 · 
Background vocal…|背景人声“
Background vocals (|背景人声，
Vocals|人声
Performer|演唱者
No Performer|未指定演唱者
Performers (|演唱者（
Person|主人
Group|组合
Assign|分配
Batch Performer|批量分配演唱者
Word Performer|字词演唱者
Use line Performer|沿用有行演唱者
Use previous line|沿用上一行
Choose Performer…|选择演唱者“
Replacement Performer|替换演唱者
Delete Performer|删除演唱者
Clear association|解除关联
Clear associations|解除所有关联
Confirm reassignment and delete|确认重新分配并删除
Apply Performer to section|分配演唱者到段落
Apply current Performer to section|将当前演唱者应用到段落
Names and stable IDs identify singers. Color and alignment are editor preferences. Create a group explicitly for unison singing.|姓名与稳安 ID 用于识别演唱者，颜色和对齐仅为编辑器设置。齐唱时请明确创建组合。
Paste lyrics|粘贴歌词
Paste whole lyrics|粘贴整首歌词
Paste your lyrics or add a line to begin.|粘贴歌词或添加一行以开始。
Import LRC / TTML|导入 LRC / TTML
Choose audio|选择音频
Export word TTML|导出逐词 TTML
Export line TTML|导出逐词 TTML
Export LRC|导出 LRC
Export both|同时导出
Load song lyrics|读取歌曲歌词
Save project file|保存工程文件
Restore project|恢名工程
Clear project|清空工程
Clear sync|清空同时
Clear sync line {0}|清空符 {0} 行同歌
Clear {0}|清空 {0}
Start of the Lyric|歌词开始
End of Lyric|歌词结束
Start|开始
End|结束
Timing|打轴
Timing mode|打轴模式
Line by line|逐行打轴
Word by word|逐词打轴
Hold to record word · T|按住记录字词 · T
Recording… release to finish|正在记录…松开以结束
Word arrow shortcuts|左右简头逐词快捷键
← / ← word sync|← / ← 逐词打轴
Undo|撤销
Redo|重做
Shift timing|偏移时间
Shift scope|偏移范围
Whole song|整首歌曲
Selected lines|所选行
Current word|当前字词
Seconds|秒
Apply shift|应用偏移
Loop line|循环本行
Loop current line|得现当前行
Listen to current line|试听当前行
Pre-roll|提前播放
Shortcuts & timing help|快捷键与打轴帮助
Default: next start|默认：下一行开始时间
Pending|待同步
{0}h {1}m {2}s|{0} 小时 {1} 分 {2} 种
Waiting|等待中
auto|自加
left|靠左
right|靠右
center|居中
title|歌曲名
artist|艺术家
album|专辑
language|请言
preview|实时预览
colors|演唱者逜色
alignment|演唱者对齐
Not marked|本打轴
Auto|自加
Automatic|自动
Start time line {0}|第 {0} 行开始时间
End time line {0}|第 {0} 行结束时间
Lyrics line {0}|第 {0} 行歌词
Listen to line {0}|试听符 {0} 表
Actions for line {0}|第 {0} 行操你
Select line {0}|选择符 {0} 表
Add line below|在下方添加一行
Split at cursor|在光标各拆行
Merge with next|与下一行合并
Move line up|上移此证
Remove line|删除此行
Write a lyric line…|输入一行歌词“
Select|选择
Batch select line {0}|批量选择符 {0} 表
Hide details|隐藏详情
Translation / romanization & details|翻译 / 音译及详情
Translation / romanization|翻译 / 音译
translation|翻译
romanization|音译
Re-record line|重新录制有行
Re-record word|重新录制字词
Follow playback|跟随播放
Lyric editor|歌词编辑包
Live lyric preview|实时歌词预览
Metadata & preview|元数据与预览
Song structure (|歌曲结构，
Structure tag|结构标的
Section from selected lines|将所选行设为段落
Choose section…|选择段落“
Remove section|删除段落
From lines|起型这
To line|结束行
Artist metadata does not assign Performers. Preview color and position stay in the project file. No automatic translation or network lookup.|歌曲艺术家不自动分配为演唱者。预览逜色和位置仅保存在工程下，不自动翻译或联网查要。
Split mode|拆分模式
Split text|拆分文本
Words|按词
Characters|按字
Manual|手动
Merge selected fragments|合并所选片段
Split syllable|拆分音节
Split after character|在字符后拆分
Syllable split position|音节拆分位置
Create boundaries from text selection|根据选中文本创建拆分边界
Word start time|字词开始时间
Word end time|字词结束时间
Listen to word|试听字词
No sung words|没有演唱单元
Word timing editor|逐词打轴编辑器
Hold T for the word’s start; release for its end and advance. Spaces and punctuation stay literal. Splitting a timed syllable needs new timing; merging across a pause also returns to Pending.|按住 T 记录字词开始，松开记录结束并前进。保留空格和标点。拆分已同来音节或跨停顿合并后，需要重新打轴。
Export needs attention|导出前需要修歌
Use line TTML instead|改用逐词 TTML
Export compatibility|导出兼对性
TTML target|TTML 目标格式
This player · AMLL community vocabulary|本播放器 · AMLL 社区格式
AMLL 1.0.1 · split Performer phrases / background lines|AMLL 1.0.1 · 拆分演唱者短句及背景人声
Independent UTF-8 lyric files. Your audio is unchanged.|导出狀立 UTF-8 歌词文件，不修改音频。
Confirm and download|确认并下载
Download|下载
Use imported project|使用导入的工程
Import into Lyric Studio|导入歌词工作室
Append lyrics|追加歌词
Use lyrics|使用歌词
One lyric line per line of text. Blank lines are skipped. You can undo a replacement.|文本每行对应一行歌词，跳过空行。替换操作可以撤销。
LRC vocals|LRC 人声策略
Lead lines only|仅导出主唱行
All vocals as separate timed lines|所有人声分分导出为时间轴
LRC annotations|LRC 附加文本
Omit|不导出
Append to each lyric line|附加到各行歌词之后
LRC stores line starts. Word ends, Performer IDs, section tags, vocal roles and overlap endings are simplified; the full project is unchanged. Choose how to handle vocals and annotations:|LRC 发保存行开始时间。字词结束、演唱者 ID、段落标签、人声耒色和重叠结束时间会简化，完整工程不变。请选择人声与附加文本的处理方式，
Compatibility notes|兼对性说明
Loading your draft…|正在载入草线“
Loading draft…|正在载入草线“
Draft restored|草线已恢密
Ready to edit|可以开始编辑
Saving draft…|正在保存草线“
Draft saved|草稿已保存
Draft not saved|草线未保存
Draft unavailable|草线不可用
Loading saved lyrics…|正在读取已保存的歌词“
Loading local preferences…|正在读取有地设置“
Opening your local library…|正在打开有地曲库“
Restoring local library…|正在恢名本地曲库“
Working…|正在处理“
Saving…|正在保存“
Saved|已保存
Retry|重试
Retry save|重试保存
Retry draft save|重试保存草的
Retry saving settings|重试保存设置
Retry song lyrics|重新读取歌曲歌词
Retry storage|重试读取存储
Retry theme save|重试保存主音
Retry playback memory|重试恢名播放位置
Save details|保存信息
Save lyrics|保存歌词
Edit details|编辑信息
Edit album|编辑专辑
Delete|删除
Edit {0}|编辑 {0}
Remove {0}|移除 {0}
Restore {0}|恢在 {0}
Audio copy unavailable|音逑副本不可用
Unable to play|无法播放
Unable to play · Double-click to retry|无法播放 · 双击重试
Choose original file|选择原型文件
Select an imported file to see its details here.|选择已导入的文件以查看详情。
Changes are saved in this player's local database. Original files stay unchanged.|更改保存在播放器有地数据库中，不修改原始文件。
Remove this player’s record and copy; keep the original file|仅移除播放器记录与副本，保留原始文件
Embedded covers take priority. Your image applies to tracks without usable embedded artwork.|优先使用内嵌封面。所选图片只应用于没有可用内嵌封面的歌曲。
Local cover image|本地封面图版
Compilation / various artists|合辑 / 多位艺术家
Sort by duration|按时长排序
Reset column widths|重置列密
Drag to resize. Double-click to fit. Arrow keys adjust width.|拖动调整列尽，双击自动适应，方向键得调。
Resize {0} column|调整 {0} 列密
Open app menu|打开应用菜单
App menu|应用菜单
Main navigation|主导航
Page history|页面历史
Go back|后退
Go forward|前进
Expand library|展开曲库
Collapse library|收起曲库
Open library|打开曲库
Resize library|调整曲库宽度
Resize details|调整详情宽度
Right sidebar view|右侧栏视图
Skip to tracks|跳到歌曲列表
View all music|查看全部音乐
View local albums|查看有地专辑
Play album|撤放专辑
Play saved track {0}|双击播放已保存歌曲 {0}
Play album {0} by {1}|撤改 {1} 的专辑 {0}
Open album {0} by {1}|打开 {1} 的专辑 {0}
Last played: {0}|上模播放：{0}
Saved library covers|已保存歌曲封面
Saved library tracks|已保存歌曲列表
Scrollable tracks|可滚动歌曲列表
Tracks|歌曲
Queue tracks|队列歌曲
Queue volume|队列音量
Choose studio audio|选择工作室音题
Choose studio lyrics|选择工作室歌词
Choose studio project|选择工作室工程
Studio format|工作室格式
Studio song|工作室歌曲
Choose audio files|选择音逑文件
Import local music|导入有地音乐
Drop to import music|拖放以导入音乐
Choose audio files from this device, or drag multiple files into this window.|从设升选择音逑文件，或将多个文件拖入窗口。
Dismiss import message|关闭导入提示
Dismiss playback error|关闭播放错词提示
Dismiss storage error|关闭存储错还提示
in this app|在此应用中
in this browser|在此浏览器一
on this device. Removing a track deletes only this player's record and copy.|保存在此设升上。移除歌曲只删除播放器记录与副本。
this app’s local storage|此应用的有地存储
browser storage|浏览器存储
Choose a song to get started|选择歌曲以开始
Bring your lyrics|导入你的歌词
Import local lyrics|导入有地歌词
Import lyrics|导入歌词
Choose a TTML or LRC file|选择 TTML 或 LRC 文件
Choose lyric file|选择歌词文件
TTML · LRC · Local files only|TTML · LRC · 仅本地文件
Supported formats|收持的格式
Lyrics could not be restored|无法恢前歌词
Checking embedded lyrics…|正在检查内嵌歌词“
Lyrics ready|歌词已准备就绪
Line timing|逐行时间
Word timing|逐词时间
Mixed line and word timing|逐行及逐词混合时间
Synced lyrics|同来歌词
Lyrics earlier|歌词提前
Lyrics later|歌词延后
Offset in seconds|偏移秒数
Lyrics offset in seconds|歌词偏移秒数
Lyrics timing: {0}{1} s|歌词偏移：{0}{1} 种
Reset timing|重置偏移
Negative plays lyrics earlier; positive plays them later. Saved for this song.|负值使歌词提前，档值使歌词延后。设置仅应用于此歌曲。
Listen from this line|从本行试听
Before you continue|继续之前
Timed|已同歌
Select fragment {0}|选择片析 {0}
{0} lines|{0} 行
Line {0}: |第 {0} 行：
{0} · Shift-click selects a phrase; double-click auditions|{0} · Shift 单击选择短句；双击试听
锛 Add Performer|（ 添加演唱者
锛 Add line|（ 添加一行
锛 Background vocal|（ 添加背景人声
锛 Instrumental range|（ 添加器乐段
 · Needs context| · 需结合上下文
(linear)|（线性值）
. Files are never uploaded. Your originals stay unchanged.|。文件不会上传，原文件保持不变。
. Originals are never changed or deleted. Songs you remove stay removed on later scans of this folder.|。不会修改或删除原文件，已移除的歌曲不会在下次扫描时重新导入。
Additional annotation {0}|附加文本 {0}
Album name, album artist and release year determine automatic grouping. Use the same grouping label to join tracks manually, or different labels to separate editions. Without an album artist, mark compilations here to keep different performers together.|自动按专辑名、专辑艺术家和发行年份分组。可使用相同分组标签合并曲目，或使用不同标签区分版本。缺少专辑艺术家时，可标记为合辑、
Analyzed files|参与分析的文件
Apple / AMLL absolute timestamps|Apple / AMLL 绝对时间
Apple / AMLL-marked files use absolute timestamps. Other TTML files use standard parent-relative timing. Sequential containers, frame/tick/clock time bases, ruby, animation and nested sidecar annotations are not supported and are reported before saving.|Apple / AMLL 标记的文件使用绝对时间，其他 TTML 使用相对于父节点的时间。不支持顺序对器、帧或时钟时间基准、Ruby、动画及嵌字附加文本，保存前会提示。
Audio|音量
Audio copies, artwork, tags and playback settings are saved|音逑副本、封面、标签及播放设置保存在
Automatic end: {0}. Leave blank to use the next start time or audio end.|默认结束时间：{0}。留空使用下一行开始或音逑结束时间。
BCP-47, e.g. zh-Hans|请言代码，在 zh-Hans
BPM & Key · |BPM 与调性 · 
Beat positions|节拍位置
Calculated from local audio ·|根据有地音频衡算 ·
Choose files|选择文件
Choose mode|选择调式
Choose tonic|选择主音
Edit|编辑
Engine|分析引擎
For|应用于
Force reanalyze {0}|强制重新分析 {0}
Full track|全曲
Full track ·|全曲 ·
Hz ← mono|Hz ← 单声道
Import MP3, WAV, FLAC, M4A, AAC, OGG and more. Playback support depends on|可导入 MP3、WAV、FLAC、M4A、AAC、OGG 等格式，播放支持取决于
Instrumental|器乐段
Interrupted|已中文
LRC: line timestamps, repeated timestamps, offset, and enhanced <mm:ss.xx> word timestamps. Missing word end times use line highlighting.|LRC：支持行时间、重复时间戳、偏移及增强逐词时间。缺少逐词结束时间时使用行级高亮。
Line actions|行操你
Listen to {0}|试听 {0}
Local library could not be restored. Retry storage above.|无法恢名本地曲库，请在上方重试读取。
Lyric {0}|歌词 {0}
Lyrics used ·|使用的歌词 ·
Manual mode|手动调式
Manual tonic|手动主音
Move Performer {0} up|上移演唱者 {0}
Needs context|需结合上下文
No concerns found|本发现问题
No interpretation yet. Analyze the selected lyrics to begin.|尚无解读，请分析所选歌词。
No mood labels supplied.|没有情绪标签。
Normalization preamp|均衡播放前级增益
Opening your local workspace…|正在打开有地工作区“
Or drop one file here. Saved only with this track, on this device.|也可将文件拖到此各，仅保存在有设升并关联此歌曲。
Parameters|参数
Performer line {0}|第 {0} 行演唱者
Performer {0} alignment|演唱者 {0} 对齐
Performer {0} color|演唱者 {0} 颜色
Performer {0} name|演唱者 {0} 名称
Performer {0} type|演唱者 {0} 类型
Powered by Essentia|用 Essentia 驱动
Protect saved library from automatic cleanup|防欢浏览器自动清理曲库
Reopen this same address and browser profile to restore your library. Clearing site data, private browsing or browser storage cleanup can remove the saved copies. Keep your original files as a backup.|使用相同浏览器配置和地址可恢名曲库。清除网站数据、隐私浏览或存储清理可能删除副本，请保留原文件备份。
ReplayGain 2.0 · −18 LUFS reference · unmodified raw gain. Preamp and clipping prevention are separate playback settings.|ReplayGain 2.0 · ∀18 LUFS 参考值 · 有修改的原型增益。前级增益和防削波为独立播放设置。
Resampling|重采标
Save correction|保存信歌
Saved songs use|已保存歌曲占用
Saving replaces this track’s saved lyrics. Audio and original files stay unchanged.|保存将替换此歌曲已存的歌词，音频及原文件保持不变。
Scope|范围
Section {0} end|段落 {0} 结束
Section {0} start|段落 {0} 开始
Seek preview: {0}|预览跳软：{0}
Seek to {0}|跳转到 {0}
Shift all times in seconds|时间偏移（秒）
Some album tags are missing. This album is grouped conservatively. Use Edit album or a track's Edit details to adjust its grouping.|部分专辑标签缺失，当前采用保守分组。可通过编辑专辑或歌曲信息调整分组。
Source|来源
Standard TTML relative timestamps|标准 TTML 相对时间
TTML: parallel body/div/p/span, begin/end/dur in clock or h/m/s/ms time, timed words, named performers, background vocals, overlapping lines, inline translations and romanization, and plain Apple sidecar annotations.|TTML：支持并行层级、时分秒和母秒时间、逐词时间、演唱者、背景人声、重叠歌词、翻译音译及基础 Apple 附加文本。
Tags from older library records will be read when you analyze the audio.|分析音逑时会读取旧曲库记录的文件标签。
This player retains inline Performers and layered vocals. AMLL conversion splits them into independent paragraphs; background roles become ordinary vocal lines and annotations stay on the first phrase. Whitespace normalization in AMLL is outside this editor. Apple official delivery and other players are unverified.|本播放器保留行内演唱者和多层人声。AMLL 软据会将其拆为独立段落，背景人声变为景通歌词行，附加文本保留在首个短句。AMLL 可能资范化空格。Apple 官方交付及其他播放器尚未验证。
UTF-8 or UTF-16 with a BOM. Up to 2 MB and 5,000 lyric lines. File colors, fonts and positioning are replaced by the player’s styles.|支持 UTF-8 或带 BOM 的 UTF-16，最大 2 MB。5,000 行。字体、逜色和位置使用播放器样式。
Unable to determine reliably|无法只靠判文
Use line timings|使用逐行时间
User correction|用户信歌
Volumen alto|高音量
Volumen apagado|静音
Volumen bajo|低音量
Volumen medio|主音量
Your library is restored when you reopen Lyric Player. This desktop library is separate from your browser library. Keep your original files as a backup.|重新打开 Lyric Player 发恢名曲库。歌面曲库与浏览器曲库狀立，请保留原文件备份。
at last refresh. This includes Chromium, playback buffers and any active analysis.|（上次刷新），包括 Chromium、播放缓冲和运行中的分析。
cache|缓存
categories reviewed|专类别已检查
ch ·|声道 ·
channels · decoded|声道 · 已解码
data|数据
detected beats saved in seconds|专节拍位置已保存（秒）
frames|常
in this app on this device|此设升的应用一
in this browser on this device using IndexedDB|此设升浏览器的 IndexedDB 下
linear|线性值
linear · 4× FIR interpolation, ITU-R BS.1770 Annex 2|线性值 · 4 值 FIR 插值，ITU-R BS.1770 附录 2
lines|行
lines with existing start times. This replaces the current draft; Undo restores it.|行已有开始时间。导入将替换草稿，可撤销恢名。
location|位置
lyric lines reference this Performer. Choose a replacement or explicitly clear these associations.|行歌词引用了此演唱者。请选择替代演唱者或明确解除关联。
lyric lines ·|行歌词 ·
selected line(s)|行已选中
the built-in audio decoder|内置音逑解码器
vocal lines. Supported word times, Performers, background vocals and annotations are retained. Undo restores your current project.|行人声歌词。将保留支持的逐词时间、演唱者、背景人声和附加文本，可撤销恢名当前工程。
your browser|浏览器
{0} analysis|{0} 分析
{0} language line {1}|第 {1} 行{0}语言
{0} line {1}|第 {1} 行{0}
{0} progress|{0} 进度
· Track|· 单曲
鈥渰0}… · {1} results|“{0}” · {1} 下结果
← / ← record the current line, then move up / down. Hold T to record a word; optionally use ← to hold/release and ← to select the previous word. Start and End of Lyric are timing markers, not sung text. Ctrl+Z / Ctrl+Shift+Z undo / redo. Shortcuts pause while editing text. Times follow the original audio timeline at every playback speed. Automatic line ends use the next start or audio end; adjust them to preserve pauses.|← / ← 都记录当前行时间，再向为 / 下移动。按你 T 记录词的开始，松开记录结束；也可开听 ← 按住录制、← 返回上一词。歌词开始和结束是时间标记，不是演唱文字。Ctrl+Z / Ctrl+Shift+Z 撤销 / 重做。输入文字时快捷键暂停，变速播放仍记录原歌曲时间轴。默认行结束使用下一行开始或音逑结束时间，可手动调整以保留停顿。
Sync Start of the Lyric.|请同步歌词开始标记。
Sync End of Lyric after the start and within the audio.|请同步歌词结束标记，时间须晚于开始且在音频范围内。
Lyric line is outside Start / End of Lyric.|此行超出歌词开始 / 结束标记的范围。
Start time is pending or invalid.|开始时间待同接或无效。
End time is pending or invalid.|结束时间待同步或无效。
End must be later than start.|结束时间必须晚于开始。
End exceeds the audio duration.|结束时间超出音逑时长。
Word time is outside its vocal line. Adjust the word or line bounds.|逐词时间超出有行范围，请调整字词或行的起欢时间。
Select a singing fragment first.|请先选择演唱片段。
Play the audio, then hold T to record a word.|请先播放音频，再按你 T 或已名用的 ← 录制逐词时间。
Recording cancelled: no valid media-time interval.|录制已取消：没有有效的媒体时间区间。
Word recorded. The next fragment is selected.|已记录当前词，并选中下一片段。
Language changed for this session but could not be saved.|本次语言已切据，但有能保存。
Loading saved lyrics…|正在读取已保存歌词“
Select a song with saved or embedded lyrics to adjust its timing.|选择后有已保存或内嵌歌词的歌曲以调整时间。
translation|翻译
romanization|音译
Playing|撤放中
Paused|已暂停
Stopped|已停歌
Loading|加载一
Ready|就绪
Queued|等待中
Decoding|解码中
Analyzing|分析中
Saving|保存中
Cancelling|取消中
Failed|失败
Cancelled|已取消
Planned|待实现
Not configured|尚未配置
Draft saved|草稿已保存
Saving draft…|正在保存草线“
No saved song lyrics.|此歌曲没有已保存的歌词。
Select a phrase in the lyric text first.|请先在歌词文字中选择一个短句。
Default: next start|默认：下一行开始
Export title markers use localMusic TTML metadata; other players may ignore them.|首尾标记使用 localMusic TTML 元数据保存，其他播放器可能忽略这些标记。
Auto detect from lyrics|自动检测歌词语言
Remove background line {0}|删除符 {0} 行背景人声
Write LRC to song copy|尚 LRC 写入歌曲副本
Write TTML to song copy|尚 TTML 写入歌曲副本
Write to saved audio copy|写入已保存的音逑副本
Writes lyrics into the player's saved FLAC, MP3 or WAV copy. The original file is unchanged. You can download the updated audio after saving.|将歌词写入播放器保存的 FLAC、MP3 或 WAV 副本。原文件保持不变，保存后台下载更新的音频。
Write lyrics|写入歌词
Audio copy ready|音频副本已就绪
Lyrics written to the saved audio copy. The original file is unchanged.|歌词已写入播放器保存的音频副本，原文件保持不变。
← / ← move to the previous / next line and record its start. After Clear sync the first press records the first line. Hold T to record a word; optionally use ← to hold/release and ← to select the previous word. End of Lyric records the end boundary. Ctrl+Z / Ctrl+Shift+Z undo / redo. Shortcuts pause while editing text. Times follow the original audio timeline at every playback speed. Automatic line ends use the next start or audio end; adjust them to preserve pauses.|← / ← 移动到上一行 / 下一行，并记录目标行的开始时间。清空同步后首模按销记录首行。按你 T 记录字词，也可名用 ← 按住/松开和 ← 返回上一词。End of Lyric 记录歌词结束。Ctrl+Z / Ctrl+Shift+Z 撤销/重做。编辑文字时快捷键暂停，各种播放速度均使用原歌曲时间轴。默认行尾采用下一行开始或音逑结束，可手动调整保留停顿。
Translation|翻译
Translation / romanization line {0}|第 {0} 行翻译 / 音译
Background translation / romanization|背景人声翻译 / 音译
Explicit line end|手动指定结束
From word timing when complete|字词同来完成后采用有词结束
Auto: next line or audio end|自加：下一行开始或音逑结束
Lyrics & timing|歌词与时间轴
Following playback|正在跟随播放
Write word TTML to song copy|将逐词 TTML 写入歌曲副本
Write line TTML to song copy|将逐词 TTML 写入歌曲副本
Save lyrics inside the library audio copy|将歌词写入曲库保存的音逑副本
Line timing & translation|逐行时间轴与翻译
Word timing, voices & translation|逐词时间轴、人声与翻译
Recording target|当前录制
Add lyrics to begin|先添加歌词
Hold T ← release ← next word|按住 T ← 松开 ← 下一请
← / ← records the destination line|← / ← 记录移动后的目标识
Audition tools|试听工具
Audition|试听
Word timing|字词时间轴
{0} / {1} words synced|已同歌 {0} / {1} 下字词
Back to sync|回到同时
Application font|应用字体
Application font file|应用字体文件
Lyric font file|歌词字体文件
System default|系统默认
Installed fonts|已安装字体
Choose font file|选择字体文件
Search installed fonts|搜索已安装字体
Reading installed fonts…|正在读取已安装字体“
No installed fonts found.|未找到已安装字体。
Installed fonts could not be read. Allow local font access or choose a font file.|无法读取已安装字体。请允许本地字体耿问，或选择字体文件。
Choose a valid TTF, OTF, WOFF or WOFF2 font under 32 MB.|请选择不超过 32 MB 的有效 TTF、OTF、WOFF 或 WOFF2 字体文件。
Font could not be loaded or saved. Choose another local font.|字体无法加载或保存，请重新选择有地字体。
Saved font is unavailable. Choose it again or use the system default.|已保存的字体不可用，请重新选择或恢复系统默认。
`;

export const zh: Record<string, string> = Object.fromEntries(pairs.trim().split('\n').map(line => { const at = line.indexOf('|'); return [line.slice(0, at), line.slice(at + 1)]; }));
