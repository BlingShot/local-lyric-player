# 首版接入实现与本地验证

2026-10-07。两个工作区已实现行级 v1 接入。此记录说明源码与本次验证结果，不代表正式服务已经部署；原设计清单中的生产放行项不能据此全部勾选。

## 已实现

- LyricFlow：公开录音匹配、完整候选集截断保护、版本/时长/标识冲突判断、公开性过滤、限流及响应大小限制。新增 `026_recording_isrcs.sql`，Spotify 可信导入写入 ISRC 关系；不会从播放器标签反向制造可信目录记录。
- `/contract` 声明 v1 能力。Worker 通过有网关认证、2 秒超时、32 KiB 上限的请求读取 Node 能力；身份服务不可用时关闭投稿声明，公开读取仍可用。现有 PostgreSQL 连接统一使用 3 秒语句超时。
- Player：`lyricflow-json`、严格校验、播放/Studio 两个 adapter、原始快照、来源关联、IndexedDB v7，以及统一的 LyricFlow → AMLL 调度。已有选中歌词优先；自动查找默认关闭，只查当前歌曲。
- 保存歌词和关联时，在同一事务检查歌曲音频、标签、歌词版本和取消状态。删除清理关联/任务；合并保留原歌曲的链接、暂停任务；传输保留原 JSON 并报告 TTML 转换与任务不随传输恢复的限制。
- Electron：独立本站 OAuth Code + PKCE、系统浏览器、随机 loopback 端口、state/nonce/RS256/issuer/audience 校验、刷新合并和连接代次检查。仅可选 Refresh Token 加密落盘；不能通过通用配置 IPC 读取令牌。
- 服务端：native/public 客户端登记、`lyrics:contribute`、明确的 Bearer-only 投稿接口、本人对象权限、强 ETag、按客户端隔离的幂等键、有效授权/账号检查；审核员和管理员通过本通道也只能提交 pending。
- Studio：「提交到 LyricFlow」三步面板，冻结工程、确认录音、公开/投稿内容比较、转换损失确认、来源声明、私人草稿保存及最终提交。sync-only 保留正文 ID、非 vocal 行、段落和复杂演唱者原值。
- 创建/保存/提交请求可在响应丢失后恢复；任务绑定 issuer/sub/clientId 和本地音频/标签身份。新增本地编辑不会混入冻结快照；支持手动刷新审核状态与撤回。

## 开发环境接线

1. 在待联调的 LyricFlow 测试数据库应用正常增量迁移，包括 `026_recording_isrcs.sql`。本次仅对自动创建的隔离测试数据库应用过迁移，没有迁移现有业务库。
2. 按 `lyric-flow-main/docs/site-identity.md` 配置 Node 身份服务。`OIDC_ISSUER` 必须等于实际公开 `API_ORIGIN + /oidc`。签名密钥及加密密钥仅放服务端。
3. 在管理员 OAuth 客户端页面登记应用平台 `native`、客户端类型 `public`。回调使用 `http://127.0.0.1/lyricflow/callback`；运行时只允许端口改变，host/path 不变。scope 为 `openid profile lyrics:contribute`；要支持「记住连接」再登记 `offline_access`。应用包不需要 Client Secret。
4. Player 设置 → 在线服务 → LyricFlow：填 API/网站 Origin，按需开启自动补充。公开读取不需要连接账号。
5. 桌面版的「已登记客户端设置」填相同 API/网站 Origin、完整 issuer 及登记的 Client ID，保存后连接账号。只使用 HTTPS 或 IP 字面量 loopback 开发地址，例如 `http://127.0.0.1:5180`；这些是示例，不是已经运行的配置。
6. Web 公开读取需要把准确播放器 Origin 加入 LyricFlow CORS allowlist。桌面请求由主进程发出，不添加 `null`、`file://` 或 `*`。Web 投稿留待独立 Web 客户端配置。
7. 打开 Studio，使用「提交到 LyricFlow」。没有对应录音或原文档时先去网站建档；播放器不会自动创建录音。能力未开放或未连接时显示原因。

## 本次通过的检查

| 范围 | 结果 |
| --- | --- |
| Player `npm run typecheck`、`npm run build` | 通过；构建有既有大 chunk 提示 |
| Player `npm test` | 149/149 通过，包含导入与转换测试 |
| `npm run test:lyricflow` | 16 项接入浏览器检查通过：竞态、切歌、去重、离线、偏移、来源修订历史、Studio 原子导入、删除/合并/传输 |
| `npm run test:lyricflow-uploads` | 上传恢复 6 组场景及真实浏览器三步面板流程通过 |
| `npm run test:lyricflow-desktop` | 9 个授权测试 + 4 个桌面策略测试通过；包含真实本地 loopback 回调及伪造响应拒绝 |
| LyricFlow 前端/后端/Cloudflare typecheck、`build`、`build:api` | 通过 |
| LyricFlow 完整后端测试 | 186/187 通过；公开匹配、本站授权、草稿提交与原网站工作流测试通过 |
| LyricFlow 完整前端测试 | 615/616 通过；OAuth 管理页新增用例通过 |
| Cloudflare 单元测试、本地 dry-run 构建 | 13/13 通过、构建通过；未执行 deploy |

上传面板测试会模拟第一次提交响应丢失，关闭/重开面板再恢复，验证两个请求使用相同 body/key，服务端模拟仅产生一条投稿，并且投稿仍是修改前的冻结文本。它验证客户端行为，不替代真实桌面与部署服务之间的人工授权验收。

## 完整回归中尚未通过的项目

以下失败位于未修改的产品路径或原有测试断言，未为本次接入扩大修复范围：

- `backend/tests/catalog-actions.test.ts:343`：原 fixture 插入 track 时缺少必填 `recording_kind`，触发 PostgreSQL 23502。
- `tests/contributionDisplay.test.tsx:97`：断言仍期待 `Verified by LyricFlow`，当前产品文案是 `Verified by Lyrvena`。
- Player `test:lyrics`：歌曲选择后的自动开始播放等待超时；接入相关迁移/导入检查已通过。
- Player `test:studio`：现有 TTML 内联演唱者导入往返差异。
- Player `test:v08`：本地歌词优先和缺失歌词 AMLL 查找通过，之后歌词排版的字形边界断言失败。
- Player `test:desktop`：沙箱外隔离 profile 已通过导入、实际播放、分析、Studio 导出和完整 Electron 重启恢复共 5 个阶段；之后旧测试等待 Settings 的 `Storage` 标题超时。未产生 pageerror，整个套件仍不算通过。

## 尚待部署环境验收

正式 API/网站/issuer/clientId、真实账号授权、正式网关/CORS、独立审核账号批准后由另一播放器读取新修订、完整安装包启动和离线重启验收，均未在本次宣称完成。生产发布、数据备份和迁移仍须按部署流程执行。

首版只提交行级副本。逐字、和声关系、译文及音译会列出损失，完整本地工程继续保留。复杂远端演唱者信息无法在全组件模式重建时阻止提交，允许选择只改行级同步。ContentV2 无损往返属于原设计 P5，尚未实现。
