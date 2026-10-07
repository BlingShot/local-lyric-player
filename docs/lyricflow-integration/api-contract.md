# LyricFlow 接入 API 与数据规范

版本：草案 1.0 · 2026-10-07。**“复用”表示源码已有；“新增/扩展”均表示待实现。** 示例用于约定字段，不代表生产服务已经支持。基础路径沿用 `/api/v1`；`apiOrigin`、`siteOrigin`、`issuer` 是三个明确配置项，不能从不可信响应中任意替换。

## 1. 接口清单

### 1.1 公开读取

| 接口 | 状态 | 用途 |
| --- | --- | --- |
| `GET /contract` | 扩展 | 在现有契约中增加 `integrations.lyricPlayer` 能力字段 |
| `GET /lyrics/resolve` | 新增 | 用录音标识/标签返回匹配结果；只读，不创建歌曲 |
| `GET /search` | 复用 | 用户手动搜索候选；普通搜索排序不能作为自动选择依据 |
| `GET /tracks/:id` | 复用 | 校验录音仍公开，读取 metadata.documentId/revisionId 和目录资料 |
| `GET /revisions/:id` | 复用 | 读取指定修订、content、components、provenance；不静默换成最新版 |
| `GET /tracks/:id/translations/:language` | 复用，后续接入 | 获取独立翻译；首版导入仅处理原文 |
| `GET /revisions/:id/export?format=lrc` | 已有，但不作主通道 | 会丢失 ID/段落/结束时间，且可能混入未打轴文本 |

客户端公开请求不携带 Cookie、Bearer 或用户本地 ID。网络传输和缓存失败不影响播放。服务端查询只看公开录音及合法公开修订，隐藏、私人草稿和待审稿不参与匹配。

建议的能力字段：

```json
{
  "integrations": {
    "lyricPlayer": {
      "version": 1,
      "resolve": true,
      "contentSchemaVersions": [1],
      "syncLevels": ["line"],
      "contributionScope": "lyrics:contribute",
      "nativeAuthorization": true,
      "oauthContribution": true,
      "submissionPolicy": "review_required",
      "maxRequestBytes": 512000,
      "maxResponseBytes": 2097152
    }
  }
}
```

这些布尔值必须来自实际部署能力；例如没有 Node 身份服务时不能返回 `oauthContribution:true`。能力字段缺失时客户端显示尚未支持投稿，不试探 Cookie 私有接口。原有 `/contract` 字段保留。

### 1.2 本站 OAuth 投稿

新增 scope：`lyrics:contribute`，仅允许管理本人歌词草稿、提交/查看/撤回本人投稿和读取贡献权限；不包含目录管理、审核、直接发布、角色变更或他人私人草稿。完整请求 scope 为 `openid profile lyrics:contribute`，用户选择记住连接时再加 `offline_access`。

新增接口放到既有 `/oauth` 命名空间，统一 Bearer 认证；下表路径仍相对于 `/api/v1`：

| 新增接口 | 请求/响应 | 复用的业务能力 |
| --- | --- | --- |
| `GET /oauth/tracks/:id/contribution-context` | `{trackId,documentId,currentRevisionId,locked,canCreateDraft,canSubmit}` | 当前账号、公开性、原文档及组件权限；不返回角色或邮箱 |
| `POST /oauth/drafts` | `{documentId}` → 201 draft DTO | `createDraft`，Idempotency-Key |
| `GET /oauth/drafts/:id` | draft DTO | 本人草稿检查 |
| `PUT /oauth/drafts/:id` | `{content}` → draft DTO | `saveDraft`，强 If-Match |
| `POST /oauth/drafts/:id/fingerprint` | `{text:{lines}}` → `{textFingerprint}` | 服务端 canonical textFingerprint；只读计算 |
| `GET /oauth/drafts/:id/changes` | `{components}` | 与草稿不可变基线比较 |
| `POST /oauth/drafts/:id/submissions` | 见下文 → 201 `{id,status:"pending"}` | 幂等、冻结草稿版本、来源校验；强制审核 |
| `GET /oauth/submissions/:id` | `{id,status,documentId,baseRevisionId,resultRevisionId,decision}` | 仅本人；decision 无决定时为 null |
| `POST /oauth/submissions/:id/withdraw` | `{}` → `{id,status:"withdrawn"}` | 仅本人 pending，Idempotency-Key |

首版不新增上传音频/任意文件接口，也不需要再造一套草稿表。状态查询使用本地已保存的 submissionId；跨设备任务列表不在本期范围。已丢响应的提交用原幂等键恢复。

不能直接将原 `/drafts` 改成“有 Cookie 或任意 Bearer 都能用”。OAuth 适配层认证后传递真实 Account 给原业务函数，保留对象归属、账号状态、组件权限及事务检查。投稿调用新增服务端策略参数（如 `publicationPolicy: 'review_required'`），使 reviewer/admin 的客户端投稿也为 pending；原网站是否直发沿用原逻辑，客户端不能传该参数。

## 2. 录音匹配契约

### 2.1 输入

```http
GET /api/v1/lyrics/resolve?title=Example%20Song&artist=Example%20Artist&album=Example%20Album&durationMs=213420&isrc=USAAA2600001
```

全部参数按 UTF-8 URL 编码；字段白名单如下：

| 字段 | 约束 |
| --- | --- |
| `isrc` | 可选；大写规范化后匹配 `^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$` |
| `spotifyId` | 可选；22 位字母数字的 track ID，不接收任意 URL |
| `title` / `artist` | 每项最多 300 字符；没有外部 ID 时二者必填 |
| `album` | 可选，最多 300 字符，仅辅助消歧 |
| `durationMs` | 可选，正整数，最大 86400000；来自实际音频时长；未知时省略 |

每次请求一个录音；不发送本地文件路径、文件名、音频 hash、音频、封面或整个曲库。即使有外部 ID，也建议带现有标题/歌手/时长用于冲突检查。URL 查询可能进入代理日志，因此该路由必须按路由模板记录访问，不保留原始查询串。

### 2.2 输出

```json
{
  "status": "matched",
  "selectedTrackId": "sp-track-4uLU6hMCjMI75M1A2tKUQC",
  "reasonCodes": ["EXACT_RECORDING_ID", "DURATION_COMPATIBLE"],
  "hasMore": false,
  "candidates": [
    {
      "trackId": "sp-track-4uLU6hMCjMI75M1A2tKUQC",
      "title": "Example Song",
      "artists": ["Example Artist"],
      "album": "Example Album",
      "durationMs": 213000,
      "recordingKind": "unknown",
      "matchedBy": ["isrc"],
      "documentId": "11111111-1111-4111-8111-111111111111",
      "revisionId": "22222222-2222-4222-8222-222222222222",
      "lyricsState": "line_complete"
    }
  ]
}
```

ID 均为说明用占位值。`status` 为 `matched | candidates | not_found`，后两者 `selectedTrackId=null`；无匹配也是 HTTP 200，`candidates=[]`。`documentId`/`revisionId` 可为 null，分别表示没有可用原文档/没有公开修订。

`lyricsState` 为 `missing | text_only | line_partial | line_complete`，指时间数据可用性，不等于审核级别。纯音乐由 `recordingKind` 表达，不制造一份空歌词当成功。

最多返回 10 个候选；内部查到第 11 个即 `hasMore=true`，此时不得因为前 10 个中只有一个看起来相近而返回 matched，用户进入普通搜索确认。候选去重按 trackId。固定、可测试的 reasonCodes 至少有 `USER_LINK`（本地关联说明）、`EXACT_RECORDING_ID`、`EXACT_METADATA`、`DURATION_COMPATIBLE`、`MULTIPLE_RECORDINGS`、`IDENTIFIER_CONFLICT`、`VERSION_CONFLICT`、`INSUFFICIENT_METADATA`。

唯一外部 ID 匹配在缺时长时仍可关联目录，但完整同步歌词自动应用要求有已测本地时长以检查范围。任何已知 ID、歌手/版本或明显时长矛盾都降为 candidates。保守元数据匹配要求服务端完成全部候选判断；不得只检查搜索第一页。

查询使用持久目录，不在每次播放时调用 Spotify。当前 `backend/spotify/import.ts` 只落库 Spotify 映射，不能声称已有可查 ISRC 索引。若首版支持 ISRC，应新增 `recording_isrcs(track_id,isrc,source,verified_at)`，主键 `(track_id,isrc)`、非唯一 `isrc` 索引；从可信提供方数据/人工目录操作写入，查询端不采纳客户端 ISRC 为目录事实。不往现有全局唯一 `external_ids` 中强行塞入 ISRC 多对多关系。

## 3. 读取和本地存储契约

### 3.1 读取两阶段

1. resolve 得到 trackId/documentId/revisionId，或者使用本地已确认关联读取 `/tracks/:id` 的最新 metadata。
2. 按明确 revisionId 请求 `/revisions/:id`。验证响应 ID、documentId 与请求上下文一致，再解析 `content.schemaVersion`。已知关联必须先重新检查公开目录；不凭旧链接扫描私人修订。

两个请求之间发布新修订可以返回已选定的旧公开快照；保存其真实 revisionId，下次显示有更新即可。若 404/隐藏或翻译来源冲突则停止，不自行从别的歌曲补齐。当前服务器公开响应使用 no-store；首版不假装已有 ETag/304 下载协议。离线导入副本是应用数据，不是放宽服务端 HTTP 共享缓存。

### 3.2 不经过有损 LRC 中转

新增应用内部源格式 `lyricflow-json`：`SavedLyrics.document.format` 和相关格式联合类型增加此值，`fileName` 使用应用生成的 `.lyricflow.json` 标识，`source` 保存版本化 JSON，而不是将 JSON 假装为 LRC/TTML。

```ts
// 新增本地存储结构，非服务端请求体。
type LyricFlowSourceV1 = {
  formatVersion: 1;
  provider: 'lyricflow';
  apiOrigin: string;
  trackId: string;       // 远端录音 ID；外层 SavedLyrics.trackId 仍为本地 ID
  documentId: string;
  revisionId: string;
  fetchedAt: number;
  snapshot: PublicRevisionV1; // 已有 GET /revisions/:id DTO，含 content/components/provenance
};
```

`origin` 扩展为 `lyricflow`，与 file/embedded/amll 并存；不要把现有仅含 ISRC/Spotify/authors 的 AMLL `remote` 对象解释成 LyricFlow 授权对象。未知 formatVersion/content schema 必须报不兼容，不按空数组继续保存。

扩展 `parseLyrics` 的明确格式分支；LyricFlow adapter 直接从行级 JSON 产生播放模型，并通过另一函数创建 Studio 工程。`StudioWorkspace.importSaved` 当前是 TTML/其他即 LRC 的二分支，必须增加 JSON 分支。来源标签、格式选择、alternates、备份/恢复及写入音频功能也必须覆盖新格式。JSON 不能直接写入音频的 LRC/TTML 标签；显式导出时调用已有导出器并给出转换报告。

### 3.3 时间、文本与身份规则

| 信息 | 服务端 → 本地 | 本地 → 服务端 |
| --- | --- | --- |
| 本文/顺序 | 保留原文、空白及 order；匹配归一化不作用于正文 | 不 trim、不合并重复副歌 |
| 行 ID | 保留稳定 lineId；若本地需换 ID，保存双向 lineMap | 既有行沿用远端 ID；新增行分配一次 ID，重试不重建 |
| 行起止 | 服务端整数 ms；播放器除以 1000，Studio 使用 ms | API 边界只接受整数 ms；未知为 null，不是 0 |
| 偏移 | 规范时间 = startMs/endMs + reference.offsetMs | 新投稿使用已确认的 Studio 时间，reference.offsetMs=0 |
| 用户偏移 | 新来源默认 0；正值使显示延后；不自动复制旧来源偏移 | 单纯本地播放校准不自动上传；Studio 已应用时不得再加一次 |
| 结束时间 | endMs=null 可保持未知；展示若推导只能存在播放视图 | 人工为 manual、推导为 derived、未知为 unknown，不能升级可信度 |
| 段落 | 映射明确支持的类型；完整原值保存在基线 | INTRO→intro、VERSE→verse、PRECHORUS→pre-chorus、CHORUS→chorus、BRIDGE→bridge、REFRAIN→refrain、OUTRO→outro、INSTRUMENTAL→instrumental |
| 演唱者 | 保留 ID、名称；多人和区间信息保留原快照 | 行归属及 units 的演唱者可映射文本 ranges；范围使用 JS UTF-16 索引，与现有服务端一致 |
| 样式 | 颜色、对齐、预滚动保留为本地设置 | 不发送，不计入云端 fingerprint |
| 译文/音译 | 首版不自动并入原文 | 不混入 text；后续独立翻译文档按 sourceLineId 对齐 |

完整演唱行起点必须有限且在已测音频时长范围内，至少存在一条非空 vocal；部分或无同步只可预览/送入 Studio。允许重叠演唱，不能按结束时间强制串行化。播放排序只影响视图，不能改原文 order。

初始 JSON → Studio 使用规范时间并记录 `timeBasis='recording'`；由现有 Studio「加载歌曲歌词」应用用户 offset 后，标记为已应用。提交面板展示偏移影响并确认使用当前工程时间，不能同时把偏移写入行起点和 reference.offsetMs。

服务端原始 snapshot 必须保留，以防本地不支持的 `post-chorus/hook/other`、多人归属、blank/note 在再次投稿时被静默清空。sync-only 投稿只更新映射到原 lineId 的 timings，未编辑组件直接复制基线。修改正文影响 ID 对齐时重新校验；不按文本去重或靠数组下标匹配重复歌词。

### 3.4 本地关联与并发

新增 `lyricflow-links` store：键 `[apiOrigin,localTrackId]`，值包含远端 trackId/documentId/已导入 revisionId、matchedBy、userConfirmed、匹配时 audioRevision/metadataRevision/本地 metadataFingerprint、baseSnapshot/lineMap。关联记录的 userConfirmed 表示用户确认，不代表远端权威认证。

新增 `lyricflow-uploads` store：按本地 taskId 存储 `issuer,sub,clientId,localTrackId,projectSnapshotHash,targetDocumentId,baseRevisionId,draftId,draftVersion,etag,submissionId,step,idempotencyKeys` 和已确认请求体；不保存令牌。冻结快照随任务保存，用于精确恢复请求，不以当前编辑器内容重新生成请求。

保存导入结果时，用一个 IndexedDB 事务检查 tracks、lyrics、关联记录，并同时写入歌词及来源关联；沿用 `saveLyrics` 的比较再写入思路。单纯在网络请求前后读两次歌曲而不在事务中检查，仍存在竞态。删除/换音频/改标签会使旧任务失效；曲目合并、恢复和传输也须处理这些新 store。

## 4. 投稿报文与转换规范

创建草稿后比较 `baseRevisionId` 与确认页预览基线。二者不同则重新生成差异并由用户确认；不能因创建草稿默认复制最新版本就直接覆盖它。

先完成本地 text.lines 与 ID 映射，然后向 fingerprint 接口提交 text，取得服务端规范指纹。再发送完整 content；不能用一个不明规则的客户端 hash 代替 `textFingerprint`。

```http
PUT /api/v1/oauth/drafts/<draftId>
Authorization: Bearer <site-access-token>
Content-Type: application/json
If-Match: "draft-<draftId>-v1"
```

```json
{
  "content": {
    "schemaVersion": 1,
    "text": {"lines": [
      {"lineId": "line-a", "order": 0, "text": "Example lyric", "kind": "vocal"}
    ]},
    "sync": {
      "textFingerprint": "<fingerprint endpoint returned value>",
      "reference": {
        "trackId": "sp-track-4uLU6hMCjMI75M1A2tKUQC",
        "source": "client",
        "externalId": null,
        "durationMs": 213420,
        "offsetMs": 0
      },
      "timings": [
        {"lineId": "line-a", "startMs": 10200, "endMs": 13400, "endSource": "manual"}
      ]
    },
    "structure": [{"lineId": "line-a", "section": "verse"}],
    "performers": {"participants": [], "assignments": []},
    "source": null
  }
}
```

此例是新内容演示，不能将空 performers 原样用来覆盖已有演唱者。原文文档 `content.source=null`；它是翻译源引用字段，**不是**投稿来源声明或本地 source 文件。若没有可靠本地时长，只提交文字或使用现有 unknown reference 语义，不伪造 catalog/server 来源。

保存响应返回真实 `{id,documentId,baseRevisionId,version,content,fingerprint,savedAt,etag}`。读取 `/changes` 得到实际 components，与用户确认的修改范围比较；多出 text/structure 等未确认组件时停止并重新展示。尤其禁止逐行转换使原 text 指纹发生变化后仍声称只是修改同步。

```http
POST /api/v1/oauth/drafts/<draftId>/submissions
Authorization: Bearer <site-access-token>
Content-Type: application/json
Idempotency-Key: <one UUID per confirmed submission operation>
```

```json
{
  "expectedDraftVersion": 2,
  "components": ["sync"],
  "provenance": {
    "source": "own_transcription",
    "declaration": "本次根据本人本地录音校对了逐行时间轴。",
    "displayRestriction": "none"
  }
}
```

components 必须是当前草稿相对基线的完整实际差异；示例 `["sync"]` 仅适用于原文等组件未变的另一个投稿场景，不能直接套在前面的新内容示例上。

来源枚举沿用 `own_transcription | licensed | public_domain | unknown`；限制为 `none | attribution_required | limited`。不预先替用户选择“本人创作/已获授权”；从 AMLL 或 LyricFlow 导入不等于用户拥有可再次发布的许可。unknown 如实记录，limited 遵循现有不允许公开发布的校验。声明是来源记录，不能自动变成 verified。

转换器返回 `{content, losses, warnings, blockingIssues, lineMap}`。损失至少区分 `WORD_TIMING_OMITTED`、`BACKGROUND_RELATION_UNSUPPORTED`、`TRANSLATION_NOT_SUBMITTED`、`ROMANIZATION_UNSUPPORTED`、`STYLE_LOCAL_ONLY`；带行/单元 ID。任何未确认的数据丢失阻止提交。核心 ID 不完整、引用悬空、多人信息无法保留或保护组件被误改是阻断项，不能仅展示 Toast 后继续。

## 5. 原生授权、CORS 与运行时

### 5.1 Electron

用系统浏览器走本站 Authorization Code + PKCE S256；应用为公共客户端，不在安装包放 Secret。将 LyricFlow 作为独立授权服务，不使用 Google 或 Spotify Token。按固定 issuer 读取 discovery，校验 issuer、state、PKCE、ID Token 的签名/aud/nonce/时间，并把任务所有者绑定 issuer+sub。

建议在现有客户端登记中新增 `applicationType: 'web' | 'native'`（默认 web，对旧数据兼容），映射至 Provider 的 `application_type`。native 首版只开放 IP 字面量 loopback 回调和登记过的固定路径，例如 `http://127.0.0.1:<ephemeral-port>/lyricflow/callback`。运行时由系统分配端口，路径/host/scheme 仍精确匹配，只有 native loopback 的端口可变；Web 回调继续精确 HTTPS。当前生产登记规则只允许 HTTPS，**必须先扩展并验证 Provider 行为**，不能用 development=true 绕过。该设计依据 [RFC 8252 §7–8](https://www.rfc-editor.org/rfc/rfc8252.html)。

主进程先绑定回环再打开浏览器；只监听 loopback，核对 Host/路径/state/一次性事务，成功或超时关闭监听。使用固定允许的授权地址打开外部页面；不让 renderer 指定任意 URL 或令牌目的地。

Access Token 放主进程内存；可选 Refresh Token 经主进程安全存储加密。加密不可用时退回会话内连接，不明文持久化。复用 Electron safeStorage 的思路，但使用项目安装版本支持的 API，并注意其保护范围与系统有关，参考 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage/)。

renderer 只接收连接状态、账户显示名和业务 DTO；preload 暴露 `connect/info/disconnect/resolve/readRevision/createDraft/saveDraft/submit/status/withdraw` 等受限操作。所有参数和 body 大小在主进程校验，禁止任意 fetch 代理。**不要把含令牌的 LyricFlow section 加进通用 getConfig 白名单**。授权刷新合并并发，取消连接后代次改变，迟到响应不得恢复令牌。

### 5.2 服务端边界

当前全局写请求会要求 Origin，直接从 Electron 主进程发 Bearer POST 会失败。应为明确注册的 Bearer-only 投稿路由加路由级策略：不接受 lf_session；校验本站 Access Token、scope、有效 grant/client、当前账号状态及对象权限；仅这些路由允许没有 Origin 的非浏览器请求，不检查 Cookie CSRF。有 Origin 时仍按现有 allowlist 检查。

不能用“只要带 Authorization 就跳过 CSRF”的全局规则。原网站 Cookie 写接口保持 Origin+CSRF；ID Token、Google/Spotify Token、错误 client、已撤销 grant、scope 不足均拒绝。幂等结果重放前也要完成当前权限与目标公开性检查，避免旧成功结果绕过下架。

`/api/v1/oauth/*` 已由 `backend/cloudflare-proxy.ts` 转发 Node 身份服务，故新增投稿适配层放这里可复用本地 Provider 令牌查询，Worker 不导入 `oidc-provider`，也不创建新的 introspection 服务。Node 调现有 PostgreSQL workflow；公开 resolve/revision 留在原公开 API 运行时。代理失败 503 保留统一 JSON/CORS 和 requestId。

Web 公开读取需要将播放器准确 Origin 加入 API allowlist。Web 投稿另登记 Web 客户端，回调必须准确 HTTPS；Bearer 请求 `credentials:'omit'`，默认令牌仅保留内存。现有 LyricFlow 前端 `apiFetch` 强制 include，不能直接拷贝为播放器客户端。桌面经主进程传输，不向 allowlist 添加 `null`、`file://` 或 `*`。

## 6. 限制、幂等和错误

沿用现有请求体上限 512000 字节、2000 行、单行 4000 字符、正文 300000 字符、ID 120 字符；本地 TTML 的 2 MiB 上限不表示服务端能接收 2 MiB 投稿。请求按 UTF-8 字节测量；公开快照建议解码后累计不超过 2 MiB，超限停止，不仅相信 Content-Length。

首版建议初值：公开 resolve 每 IP 60 次/分钟，下载 120 次/分钟，搜索 3 秒数据库预算；客户端一次活动查找、10 秒请求超时。实际限流需在部署压测后调整，不是当前能力声明。投稿沿用服务器现有账户限流；UI 显示 Retry-After。匿名 IP 限流须考虑共享网络，不能用它证明用户身份。

创建草稿、提交、撤回分别分配幂等键，并在发请求前持久化请求体。幂等隔离范围包含 user、client、操作及对象；不能与网站现有 scope 意外重叠。同一请求重试沿用原键；用户修改内容则是新操作，不能换键掩盖不确定结果。

| 情况 | 客户端动作 |
| --- | --- |
| GET 超时/502/503 | 保留本地，至多两次带抖动退避；取消/离线立即停止 |
| POST 结果丢失 | 相同请求体+原幂等键查询式重试；不另建草稿/投稿 |
| PUT 保存超时 | GET 草稿比对 content/fingerprint/version；已一致则成功，否则显示冲突，不盲改 ETag |
| 400 CREDENTIAL_CONFLICT | 修正客户端传输，不能选择更高权限身份继续 |
| 401 TOKEN_INVALID | 合并一次刷新；失败则保留任务并重新连接 |
| 403 SCOPE_INSUFFICIENT（新增）/权限锁定 | 重新授权或显示受保护组件；不自动降权清空组件 |
| 404 | 区分远端不可用与查询无匹配；保留本地副本 |
| 409 IDEMPOTENCY_KEY_REUSED | 停止，说明请求内容与已保存操作不一致 |
| 412 DRAFT_VERSION_CONFLICT | 展示本地/基线/远端差异，用户选择重新对齐 |
| 413 / 422 | 定位过大内容、行或引用；禁止自动截断歌词 |
| 428 IF_MATCH_REQUIRED | 客户端缺少前置版本，重新读取草稿 |
| 429 | 遵守 Retry-After；不将限流缓存成“没有歌词” |

仅 not_found 可短暂负缓存（建议 10 分钟），键含 apiOrigin、匹配元数据和匹配算法版本；手动重试绕过负缓存。错误不写入“没歌词”记录。已成功下载的来源缓存与已选离线歌词分开管理。

## 7. 后续无损格式的准入条件

如目标变为“Studio 逐字工程原样上传后再取回”，仅增加 TTML 文件上传接口不够。需要新的内容 schema（建议 v2），定义稳定 unitId、逐字起止、主唱/和声父子关系、注释 targetId、语言和来源依赖，并让以下链路同时支持：

1. 严格解析和限额、持久化、canonical fingerprint；单位为整数 ms，保留原文/空白和稳定 ID。
2. 草稿差异、冲突比较、审核预览、组件权限及公开发布；word timing 变化归属 sync，正文变化失效对应时间轴。
3. v1/v2 能力协商与降级报告；旧客户端不会把新字段抹掉。
4. JSON 为规范内容，TTML 为可校验的导入/导出表示；收到原始 TTML 不能绕过结构验证或审核。
5. 明确测试 `Studio → v2 → Studio` 的文本、ID、时间、和声、注释等语义等价；不能以 XML 字符串相同代替语义验收。

翻译继续考虑使用既有独立文档和 sourceLineId 机制，避免同一信息同时放原文 annotations 和翻译文档却没有权威来源。完整 v2 是独立设计/实现阶段，不作为行级首版已经完成的能力。
