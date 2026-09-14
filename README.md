# Lyric Player

本项目是一个离线优先的本地音乐播放器与歌词管理应用，基于 React + Vite + Redux 构建，支持 Web 运行和 Electron 打包运行，核心目标是统一“导入本地音乐 -> 导入/编辑歌词 -> 分析 -> 播放管理”的闭环。

## 主要功能与特色

### 1) 本地音乐库与导入
- 支持手动选择音乐文件导入。
- 支持自动文件夹导入（桌面端和浏览器目录选择器两种模式），可持续监听新增文件并入库。
- 使用 IndexedDB 缓存导入记录与音频副本，提升下次启动恢复速度。
- 支持封面、艺术家/专辑/流派/技术元数据展示与持久化。
- 播放、队列、专辑分组、排序、搜索、歌单等基础管理能力均有内置状态管理。

### 2) 歌词工作流（Lyrics）
- 支持本地歌词文件导入（TTML/LRC）。
- 支持逐行显示、偏移校准、字体与显示样式设置、全屏阅读。
- 支持从当前播放曲目快速跳转到 Lyric Studio 继续编辑。
- 歌词显示与播放器状态联动，并保留当前曲目下的歌词偏移与外观配置。

### 3) Lyric Studio
- 提供独立的逐字/逐行编辑工作台入口（`/studio`）。
- 支持从分析结果回流、打开历史会话、基于歌曲 ID 加载/恢复上一会话。
- 与页面路由联动，支持对当前库内歌曲进行歌词编辑与后续查看。

### 4) 音频与歌词分析
- 提供 `/analyze/:trackId` 分析页，可在单曲层面查看：
  - 歌词智能分析数据（基于 DeepSeek 配置）
  - 音频分析
  - 响度（ReplayGain/Loudness）分析
- 支持语言/模型参数切换与分析来源选择。
- 分析结果与源输入可追踪、可刷新、可回退到可复现状态。

### 5) 用户体验与主题
- 支持明暗主题切换和界面配置持久化。
- 支持播放器偏好（音量/顺序/重复/队列）恢复。
- 支持桌面端窗口配置（zoom/theme）与字体设置。

### 6) 工程能力与发布
- 有完整的启动/构建脚本：`dev`, `build`, `preview`, `desktop:dev`, `desktop:build`。
- 覆盖大量测试脚本（库、离线、studio、analysis、desktop、界面测试等）。
- 桌面模式通过 `electron` 与 `electron-builder` 打包。

## 代码架构（可见亮点）
- 入口初始化：`src/index.tsx`（初始化库恢复、目录导入、主题、语言、DeepSeek 配置、播放器运行时）
- 应用壳：`src/App.tsx`
  - 路由：`/`、`/collection/*`、`/lyrics`、`/analyze/:trackId`、`/studio`
  - 全局状态：Redux + Ant Design 主题配置
- 业务核心
  - 曲库与导入：`src/library/*`
  - 播放器运行时：`src/player/*`
  - 歌词：`src/lyrics/*`、`src/pages/Lyrics`
  - Studio 编辑：`src/pages/Studio`、`src/components/Studio/*`
  - 分析：`src/pages/Analyze`、`src/analysis/*`
- 存储与设置：`src/library/database.ts`、`src/theme/*`、`src/store/*`

## 依赖与许可说明
- 仓库主许可：`LICENSE`（MIT）
- 核心第三方能力来源与许可证
  - `essentia.js@0.1.3`（AGPL-3.0）
  - `@applemusic-like-lyrics/ttml@1.0.1`（TTML 相关）
  - `React`、`Redux`、`Ant Design`、`electron` 等按其官方授权
- 相关许可证文件可在仓库内 `public/licenses` 和 `build/licenses` 查看。

## 运行方式

- 本地开发（网页）
```bash
npm install
npm run dev
```

- 预览构建产物
```bash
npm run build
npm run preview
```

- 桌面开发 / 打包
```bash
npm run desktop:dev
npm run desktop:build
```

## 参考来源与“引用代码源”
- `spotify-react-web-client`：本项目的界面交互与本地播放器工作流在架构和路由组织上有明显的承接关系。
- `AAML` / `AMLL`：TTML 及歌词时轴语义相关能力采用该生态标准思路与兼容机制（通过 `@applemusic-like-lyrics/ttml` 结合项目实现）。
- `Essentia.js`：用于音频分析能力接入。
- 本仓库内现有 `docs/*` 为验证与行为说明文档，可用于复现和回归。

Tips: Vibecoding lesson test XD
