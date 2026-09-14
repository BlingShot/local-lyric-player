# Lyric Player

一个**离线优先的本地音乐播放器与歌词管理工具**，基于 React + Vite + Redux Toolkit 构建，支持 Web 运行和 Electron Windows 桌面端。

项目主要围绕：

**本地音乐导入 → 歌词导入 / 编辑 → Lyric Studio 打轴 → 音频 / 歌词分析 → 本地播放**

界面与部分交互设计参考 Spotify，但项目本身不接入 Spotify 在线曲库、Web API 或 Playback SDK。

## Features

### Local Music

* 导入本地音乐文件
* 支持 MP3、FLAC、WAV、M4A、AAC、OGG、Opus、AIFF、WebM 等格式
* 文件夹递归导入
* 自动读取歌曲标签与封面
* 本地搜索、排序、专辑分组
* 播放队列、随机播放、循环播放
* 使用 IndexedDB 保存音乐副本与曲库数据

### Lyrics

* 支持 LRC / TTML
* 支持读取部分音频内嵌歌词
* 歌词同步滚动
* 时间偏移调整
* 全屏歌词
* 字体、字号和行距设置

### Lyric Studio

独立歌词制作页面：

```text
/studio
```

支持：

* 粘贴歌词
* 导入 LRC / TTML
* 逐行打轴
* 逐字打轴
* Undo / Redo
* 时间轴整体或局部偏移
* 当前行试听与循环
* TTML 实时预览
* 导出 LRC / TTML
* 保存和恢复 Studio 工程

同时支持将歌词写入应用保存的 **MP3 / FLAC / WAV 音频副本**，不会修改最初导入的原始文件。

### Analyze

单曲分析页面：

```text
/analyze/:trackId
```

包含：

* DeepSeek 歌词分析
* BPM 分析
* Key 分析
* ReplayGain / Loudness
* Integrated LUFS
* Loudness Range
* True Peak

音频分析基于 Essentia.js。

> DeepSeek 歌词分析是可选在线功能，需要自行配置 API Key。其他核心播放和歌词功能以本地数据为主。

## Tech Stack

* React 19
* TypeScript
* Vite
* Redux Toolkit
* React Router
* Ant Design
* IndexedDB
* music-metadata
* Essentia.js
* Electron
* electron-builder

## Development

要求：

```text
Node.js >= 22.13.0
```

安装并启动：

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
npm run preview
```

Electron：

```bash
npm run desktop:dev
npm run desktop:build
```

当前桌面构建目标为 **Windows x64 Portable**。

## Main Routes

```text
/
/collection/tracks
/search
/collection/albums
/album/:albumId
/lyrics
/analyze/:trackId
/studio
```

## Credits

本项目部分前端基础、页面结构和早期 UI 实现来源于 / 改造自：

**francoborrelli/spotify-react-web-client**

https://github.com/francoborrelli/spotify-react-web-client

原项目使用 MIT License。

本项目的部分视觉设计与播放器交互语言参考 Spotify。Spotify 名称及相关商标归其权利人所有，本项目与 Spotify 不存在官方关联。

TTML 相关能力使用 / 参考 Apple Music-like Lyrics 生态，并使用：

```text
@applemusic-like-lyrics/ttml
```

音频分析使用：

```text
essentia.js
```

## License

仓库根目录保留上游项目的 MIT License。

部分第三方组件采用独立许可证，相关文件可见：

```text
public/licenses/
```

其中 Essentia.js 相关许可证为 AGPL-3.0。

---

**希望期末可以满分AWA**
