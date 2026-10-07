# 实施顺序、文件落点与验收

> 首版源码和本地验证结果见 [实现状态](implementation-status.md)。本页清单保留阶段放行要求；不能用本地模拟和隔离数据库测试替代生产部署/真实桌面验收。

版本：草案 1.0 · 2026-10-07。本文是执行清单，未实施项均保持未勾选。本次只新增设计文档，未修改业务代码、注册 OAuth 客户端、迁移数据库、访问用户曲库或部署服务。

先阅读 [产品设计](README.md) 和 [API 与数据规范](api-contract.md)。建议按下面六个阶段交付，每个阶段都有可独立验证的结果；不要先在 Studio 挂一个尚无可用后端的上传按钮。

## 1. 按阶段推进

### P0：冻结现状和接口样例

- [ ] 明确开发 API、网站 Origin、OIDC issuer 和 Electron/Web clientId；配置用示例值，不把正式 Key 写进文稿或前端。
- [ ] 读取正在联调版本的 `/contract` 和 OpenAPI，与源码比对；不能由文档推断生产已部署。
- [ ] 建立双方共用的 JSON fixtures：有完整行轴、缺行轴、纯文本、多演唱者、同名不同版、重复副歌及已下架对象。
- [ ] 定义 `ContentV1` 公共 DTO 与本地 adapter 边界；客户端只引用契约，不引用带数据库/Node 依赖的 backend 文件。
- [ ] 修订已有 API/身份文档中影响接入的过时描述，包括 issuer 当前由 `API_ORIGIN + /oidc` 校验、现有高权限账号直发分支。

放行条件：示例内容能通过当前服务端 contentSchema；双方对 ID、ms、offset、schemaVersion、行级首版范围有一致理解。

### P1：公开匹配与可播放导入

- [ ] 新增只读 `/lyrics/resolve`，实现标识冲突、多候选和完整候选集判断；普通搜索仍供人工选择。
- [ ] 如启用 ISRC 匹配，先增加持久索引及可信导入写入；已有数据无可靠 ISRC 时回退元数据，不伪造“标识精确匹配”。
- [ ] `/contract` 暴露实际接入能力；匿名 resolve 与下载限流，隐藏过滤与请求体/响应体限额。
- [ ] 写两个纯函数：`revisionToPlayerDocument`、`revisionToStudioProject`；完整原快照用于编辑往返，播放模型只用于展示。
- [ ] 扩展内部 `lyricflow-json` 源格式、解析器、来源标签与格式分支；未打轴内容不进入完整同步歌词保存路径。
- [ ] 新增自动补充开关、手动查找/候选比较、来源展示；初始化网络设置失败时继续本地播放。
- [ ] 将 LyricFlow 与 AMLL 纳入一个调度入口，复用取消、去重和来源选择，不让两套任务直接争抢保存。
- [ ] 事务内验证歌曲及歌词版本，原子保存歌词和来源链接；准备好离线、删除、改标签和快速切歌处理。

放行条件：一首已有公开歌词的本地歌能自动导入、重启后离线播放；同名 live/remix 不误导入；用户已有歌词不被覆盖。

### P2：原生 OAuth 与受限业务通道

- [ ] Provider 与管理员登记支持 native/public 客户端及 loopback 端口规则，保留 Web 精确回调。
- [ ] 增加 `lyrics:contribute` scope、同意页文案、scope allowlist 和实际资源校验。
- [ ] 抽取可复用的本站 Bearer 校验，验证 token/grant/client/current account，不复用 Cookie 或上游 Token。
- [ ] 新增 `/oauth` 投稿路由，给明确路由设置认证策略；按路由测试 Origin/CSRF，不用 Authorization 的存在作为免检条件。
- [ ] Electron 增加授权服务、主进程业务请求和受限 IPC；state/nonce/PKCE 与 Spotify 完全隔离。
- [ ] 独立安全保存可选 Refresh Token，不向通用 getConfig、renderer、导出文件和日志暴露。
- [ ] 断开连接、账号切换、刷新失败和应用重启后正确恢复连接状态；不同 issuer/sub 不能恢复上一账户上传任务。
- [ ] Cloudflare 路由走现有 Node identity gateway；验证 OPTIONS、代理 503 和业务错误响应。

放行条件：真浏览器授权完成后可读本人投稿上下文；原生生产配置无需假装 development；撤销授权后访问失败；只读导入不要求账号。

### P3：Studio 行级投稿闭环

- [ ] 新增上传面板，先冻结本地快照，再选录音、计算转换损失与组件差异。
- [ ] 增加 `projectToContentV1`，保留远端基线与 ID；sync-only 不重新生成文本 ID。
- [ ] 创建草稿，核对 baseRevisionId，再取 fingerprint、If-Match 保存，展示服务端确认的 savedAt/version。
- [ ] 原网站 `submitDraft` 增加服务端调用策略；OAuth 投稿强制 review_required，管理员也不能经此通道隐式直发。
- [ ] 持久保存每一步的请求体和幂等键，断网/关窗/响应丢失后恢复同一操作；不自动提交后来编辑的版本。
- [ ] 服务端验证实际 components 与确认范围一致；来源声明、保护组件、无变化、下架等失败有明确反馈。
- [ ] 以 submissionId 查询 pending/approved/rejected/conflicted/withdrawn；面板可见时手动刷新或低频查询，离线/隐藏停止，不创建长期后台监控。
- [ ] 无对应录音时保留本地并打开网站建档流程；首版不新增自动建歌权限。

放行条件：普通用户提交后 pending，第二个审核账号批准后出现新公开 revision，另一播放器实例能读取该修订；本地工作中版本不会误标为已经提交。

### P4：部署与兼容回归

- [ ] 备份后应用增量迁移，使用新的迁移序号；不修改已应用 migration checksum。
- [ ] 配置开发/生产不同 clientId、准确 Origin 和 issuer；先验证 Node+代理再开启客户端投稿能力。
- [ ] 更新客户端内部格式版本/解析器版本和 IndexedDB；验证升级失败保持旧数据。
- [ ] 先发布服务端兼容接口，再发布客户端；功能开关关闭时 UI 仍可本地使用。
- [ ] 验证库导出/恢复、歌曲删除/合并/撤销合并、来源切换、新旧工程文件；不把内部 JSON 原样写入音频歌词标签。
- [ ] 记录请求成功率、错误码、耗时、冲突和转换阻断数；日志不收集音频、歌词正文、token、state/授权码及本地路径。

放行条件：验收矩阵全部完成，具备关闭新增能力且保留本地数据的回退路径。首版新增内部格式后，旧版客户端未必能识别；回退必须使用事前备份/新版本兼容读取，不承诺直接安装旧包即可读取新数据。

### P5：逐字和完整格式

- [ ] 独立确定 ContentV2 的单位/和声/注释/翻译权威模型。
- [ ] 同步升级持久化、差异、审核、验证和公开读取，增加 capability 协商。
- [ ] 完成双向语义 round-trip 后，才将 UI 改为「支持逐字无损提交」。

若要求第一版就保留所有 TTML 信息，应把 P5 提前作为上传功能的前置条件；P1 的公开行级读取仍可先交付。

## 2. Player 文件落点

下面新文件是建议命名；实现时按现有工程风格调整，不为一个接口引入全局 SDK 框架。

| 文件/模块 | 最小必要改动 |
| --- | --- |
| `src/integrations/lyricflow/client.ts`（新增） | 公开 DTO/响应校验、业务请求、错误归一化；选择 Web fetch 或桌面 bridge |
| `src/integrations/lyricflow/adapter.ts`（新增） | JSON→播放/Studio；Studio→ContentV1；losses/lineMap，不进行网络请求 |
| `src/integrations/lyricflow/repository.ts`（新增） | 关联和上传任务持久化；不持久化令牌 |
| `src/lyrics/useResolvedLyrics.ts`、`src/lyrics/amll.ts` | 统一调度、来源优先级、任务代次及取消；AMLL 保存也遵守当前来源策略 |
| `src/lyrics/types.ts`、`parse.ts`、`repository.ts`、`capabilities.ts` | 新内部格式/来源、解析重建、事务保存、切换和标签 |
| `src/library/database.ts` | 当前 DB 版本为 6；实现时取最新版本再递增，创建新 stores，涵盖删除及事务 |
| `src/library/duplicateCleanup.ts` 与现有传输代码 | 显式迁移/清理新关联、上传任务；不将两个不同远端录音链接随意合并 |
| `src/studio/project.ts` | 新增可选集成元数据；旧 version 2 工程可继续打开，源基线随工程可恢复 |
| `src/components/Studio/StudioWorkspace.tsx` | JSON 导入分支、上传入口和状态；不把 fetch/协议流程塞进大型组件 |
| `src/components/Studio/LyricFlowSubmit.tsx`（新增） | 录音、差异、损失和来源的三步面板 |
| `src/components/Settings/LyricFlow.tsx`（新增） | 自动补充、连接状态、断开；复用现有设置容器与样式 |
| `electron/lyricflow.mjs`（新增） | PKCE/回调、令牌生命周期、允许的 API 操作 |
| `electron/settings-ipc.mjs`、`preload.cjs`、`policy.mjs`、`src/desktop/types.d.ts` | 有限 IPC、参数校验、可信窗口/URL 边界、桥类型 |
| `electron/config.mjs` | 受限加密会话存储；不能把内部凭据 section 暴露给通用 IPC |
| 现有 i18n 文件 | 同步加入中英状态、错误和转换提示 |

`projectToPlayer` 当前要求行起止有效，且用于 TTML 项目；不要为兼容未打轴远端内容全局放松它。LyricFlow 的播放 adapter 可按现有 LyricLine 的可选 end 构造逐行显示，未知起点则走 Studio 草稿路径。

文件删除时清理本地关联和未完成任务，不顺带撤回已上传稿件；撤回是单独用户操作。曲库导出不含 token，恢复后的上传任务默认暂停，重新验证 issuer/sub/目标版本后才允许继续。历史 baseSnapshot 可能包含正文和贡献来源，视同工程数据处理。

## 3. LyricFlow 文件落点

| 文件/模块 | 最小必要改动 |
| --- | --- |
| `backend/lyric-resolve.ts`（新增） | 公开录音检索与确定性匹配，隐藏过滤、多候选与限流 |
| `backend/app.ts` | 注册 resolve；扩展 `/contract`；明确注册的 Cookie/Bearer 路由策略 |
| `backend/contracts.ts` | resolve DTO、OAuth 适配请求/响应 schema 与 OpenAPI |
| `backend/oidc.ts` | 新 scope、native 登记、客户端校验和可复用 Bearer principal |
| `backend/oauth-lyrics.ts`（新增） | Node 侧受限投稿路由；调用现有 workflow，不复制一套数据库业务 |
| `backend/workflow.ts` | 仅增加投稿的强制审核策略及必要共享 helper；保留真实账号和原角色 |
| `backend/content.ts`、`contribution-power.ts` | v1 沿用严格 schema 与组件锁；P5 才扩展字级内容 |
| `backend/cors.ts`、`cloudflare-proxy.ts`、`identity-gateway.ts` | 精确跨域、受限网关；新 `/oauth/*` 复用现有代理；验证失败也有统一响应 |
| `backend/migrations/<next>_recording_isrcs.sql`（需要 ISRC 时新增） | 非唯一 ISRC 索引；从可信记录补齐，不能把客户端标签直接回填为权威 |
| `backend/spotify/import.ts` | 保存已获取的 ISRC 来源关系；不在公开匹配热路径调用 Spotify |
| `src/admin/OAuthClients.tsx` | native/web 登记选项、回调说明、scope 校验反馈 |
| 既有授权同意页、相关 i18n | 将 lyrics:contribute 翻译为“管理你的歌词草稿并提交审核” |
| `docs/api.md`、`docs/site-identity.md` | 同步实际支持的授权/客户端/投稿行为，链接本规范 |

现有 PostgreSQL `external_ids` 的唯一性是 provider/resourceType/externalId，录音/专辑/作品也不是同一个概念。新匹配查询需要直接看关系和可信来源，不能根据 `sp-track-` 字符串前缀自行猜映射。

## 4. 验收矩阵

| 场景 | 必须观察到的结果 | 层级 |
| --- | --- | --- |
| 唯一 ISRC/Spotify ID 且时长兼容 | 选中同一录音，读取指定公开 revision | 后端+集成 |
| 两个外部 ID 相互矛盾 | candidates/冲突提示，零自动应用 | 后端 |
| 同名 live/remix/伴奏、专辑重发、多 artist 表达 | 不删除版本词；不能唯一证明时交给用户 | 匹配 fixtures |
| 候选超过返回上限 | hasMore；不能冒充唯一结果 | 后端 |
| 服务端缺歌词/纯音乐/仅原文/部分时间轴 | 各状态准确；不生成伪时间戳 | adapter+界面 |
| LRC 导出包含未打轴行 | 主流程仍读取 JSON，不把它作为合法同步 LRC | adapter |
| 重复副歌、空行、emoji 演唱者区间 | lineId 不重建，UTF-16 ranges 不错位，正文空白不变 | adapter |
| server offset + 用户 offset | 只应用一次；新来源不继承另一来源校准 | adapter+浏览器 |
| 已有本地 LRC/TTML、AMLL 与 LF 同时到达 | 本地保留；一次选源、一次写入，无迟到覆盖 | 浏览器 |
| 删除歌曲/换音频/改标签/切歌发生在请求期间 | 旧请求取消或事务拒绝 | IndexedDB+浏览器 |
| IndexedDB quota/升级被其他标签阻塞 | 原数据保留、清晰报错、无虚假成功 | 浏览器 |
| 断网后重启 | 已导入歌词仍可用 | 浏览器/桌面 |
| OAuth 错 state/nonce/PKCE、错误 issuer/aud、码重用 | 拒绝，令牌和授权码不出现在日志 | 身份集成 |
| 原生随机 loopback 端口、错误路径/Host | 合法授权成功，错误回调失败，监听及时关闭 | 真实桌面 |
| Cookie+Bearer、Google/Spotify/ID Token、scope 不足 | 拒绝；不能绕过网站 CSRF 或获得管理权限 | 后端 |
| 账号禁用、client 禁用、grant 撤销、refresh 重放 | 新请求失败，任务保留且要求重新连接 | 后端+桌面 |
| 客户端是 reviewer/admin | 仍 pending；无直发；原网站行为保持 | 后端 |
| sync-only 投稿 | 服务端 `/changes` 仅 sync；text 指纹、ID、其他组件不变 | 契约+后端 |
| 本地逐字/和声/译文无法表达 | 列出损失；未确认不提交；原工程完整 | adapter+界面 |
| 远端保护 text/structure | 403 并定位原因，不清空受保护字段重试 | 后端+界面 |
| 创建时远端基线已更新 | 重新显示差异，不覆盖刚发布内容 | 集成 |
| 保存返回丢失、提交响应丢失、连续双击、重启恢复 | 相同请求+原幂等键得到同一对象；无重复投稿 | 真实 DB+客户端 |
| 两设备保存同草稿 | 第二个得到 412，有可恢复的本地快照 | 真实 DB+界面 |
| 提交期间继续编辑 | 云端只含冻结版本，新本地编辑不标为已上传 | 浏览器 |
| 跨账号重新连接 | 任务所有者不匹配时暂停，不能借新账号重放 | 桌面 |
| 批准/拒绝/冲突/撤回 | 状态正确；只有批准后出现公开修订 | 端到端 |
| Worker→Node 不可用 / CORS 预检 | 可读的 503/明确拒绝，无伪装成无歌词 | Cloudflare |
| 日志、曲库导出、通用 getConfig | 无 token/授权码；无隐式音频或本地路径上传 | 桌面检查 |

以这些跨边界行为编写测试，避免只断言实现调用了自己的 helper。后端事务、幂等和版本冲突测试使用独立真实 PostgreSQL 测试库，不用生产数据库。浏览器测试使用隔离 IndexedDB；不清用户资料目录。

## 5. 实现完成后的检查命令

这些命令是后续执行建议，本次文档工作没有运行或宣称通过业务测试。

Player（`E:/coding/local-lyric-player-lyrvena`）：

```powershell
npm run typecheck
npm test
npm run test:lyrics
npm run test:studio
npm run test:v08
npm run test:desktop
npm run build
```

还需新增接入专用 tests/scripts，覆盖上述录音匹配、格式往返和投稿恢复；已有 test:v08 的模拟在线桥不能替代真实 LyricFlow 联调。不要为了验证文档去打包正式安装包。

LyricFlow（`E:/coding/lyric-flow-main`）：

```powershell
npm run typecheck
npm run typecheck:backend
npm test
npm run test:backend
npm run build
npm run build:api
```

使用 Cloudflare 部署时再运行 `typecheck:cloudflare`、`test:cloudflare`，并在测试环境验证实际 Node 身份网关。仅 dry-run 构建成功不足以证明真实桌面登录可用。

## 6. 源码依据与核对范围

以下链接对应编写时实际检查的代码。项目后续更新后以新源码/生成契约为准。

| 结论 | 源码 |
| --- | --- |
| 本地 ID/ISRC/时长字段 | [LocalTrack](../../src/library/importFiles.ts) |
| 原有在线任务及 AMLL 保存行为 | [useResolvedLyrics](../../src/lyrics/useResolvedLyrics.ts)、[amll](../../src/lyrics/amll.ts) |
| 歌词版本比较保存、offset | [repository](../../src/lyrics/repository.ts)、[useLyricFrame](../../src/lyrics/useLyricFrame.ts) |
| 当前 source 格式限制和解析器 | [types](../../src/lyrics/types.ts)、[parse](../../src/lyrics/parse.ts) |
| 工程模型及导入分支 | [project](../../src/studio/project.ts)、[StudioWorkspace](../../src/components/Studio/StudioWorkspace.tsx) |
| IndexedDB 版本和事务 | [database](../../src/library/database.ts) |
| 桌面授权与配置基础 | [spotify](../../electron/spotify.mjs)、[config](../../electron/config.mjs)、[settings-ipc](../../electron/settings-ipc.mjs) |
| LF 行级内容、文本指纹和校验 | [content](../../../lyric-flow-main/backend/content.ts) |
| LF 路由、Cookie 写保护、契约 | [app](../../../lyric-flow-main/backend/app.ts)、[contracts](../../../lyric-flow-main/backend/contracts.ts) |
| LF 草稿、幂等、高权限直接发布 | [workflow](../../../lyric-flow-main/backend/workflow.ts) |
| LF LRC 丢失信息和部分行未打轴输出 | [formats](../../../lyric-flow-main/backend/formats.ts) |
| LF OIDC scope、issuer、回调限制 | [oidc](../../../lyric-flow-main/backend/oidc.ts) |
| LF Node/Worker 边界与精确 CORS | [cloudflare-proxy](../../../lyric-flow-main/backend/cloudflare-proxy.ts)、[cors](../../../lyric-flow-main/backend/cors.ts) |
| LF Spotify 导入实际持久化信息 | [spotify/import](../../../lyric-flow-main/backend/spotify/import.ts) |

两个仓库都检测到 `.codegraph/`，代码定位先使用 CodeGraph，补读未覆盖的具体范围与配置文档。本次未读取密钥文件、生产数据或用户音频；没有把历史文档的测试结果当成本次验证结果。

外部协议依据仅用于授权设计：[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/)。前者支持系统浏览器、PKCE 和原生 loopback 的建议；后者说明主进程安全存储及其平台边界。具体库行为仍需针对锁定版本完成 P2 验收。
