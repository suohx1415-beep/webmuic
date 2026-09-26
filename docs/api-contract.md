# webmuic API 契约

网关监听 `http://127.0.0.1:8787`，所有业务接口挂在 `/api` 下。
前端（Vite dev server，`http://127.0.0.1:5173`）通过同源 `/api` 代理访问网关，因此浏览器只会和本机通信。

## 通用约定

- **响应一律是 JSON**，字符集 UTF-8。
- **错误格式统一**：

  ```json
  { "error": { "code": "URL_UNAVAILABLE", "message": "可读的中文说明", "platform": "qq" } }
  ```

- **曲目 id**：`${platform}:${platformTrackId}`，例如 `netease:2652820720`、`qq:0039MnYb0qxYhV`。
- **平台**：`netease` | `qq`。
- **对外音质档位**（四档，内部再映射到各平台原始参数）：

  | 档位 | 含义 | 网易云映射 | QQ 映射 |
  | --- | --- | --- | --- |
  | `standard` | 标准 128k | `level=standard` | `quality=128` |
  | `high` | 高品质 320k | `level=exhigh` | `quality=320` |
  | `lossless` | 无损 | `level=lossless` | `quality=flac` |
  | `hires` | Hi-Res | `level=hires` | 无对应档位，会降级到 `lossless` |

- **凭证永远不下发**：所有响应都不含 cookie 明文，`fingerprint` 是 sha256 前 8 位（不可逆）。

### 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | 参数不合法 |
| 401 | `CREDENTIAL_EXPIRED` | 凭证缺失或失效 |
| 404 | `NOT_FOUND` | 曲目/歌单不存在或不可访问 |
| 410 | `URL_UNAVAILABLE` | 该曲目对当前身份不可播（文案会区分「未配置凭证」与「凭证可能失效」） |
| 429 | `RATE_LIMITED` | 本地限速队列已满 |
| 502 | `UPSTREAM_UNAVAILABLE` | 平台后端不可达 |
| 502 | `UPSTREAM_BAD_SHAPE` | 平台返回结构不符合预期 |
| 503 | `PLATFORM_COOLDOWN` | 连续异常触发平台冷却（默认 3 分钟） |

## 目录

### `GET /api/health`

平台可达性 + 凭证状态。探测结果缓存 5 秒。

```json
{
  "ok": true,
  "gateway": { "name": "webmuic-gateway", "uptimeMs": 12345 },
  "platforms": [
    {
      "platform": "netease",
      "reachable": true,
      "upstreamStatus": 200,
      "latencyMs": 4,
      "cooldownMs": 0,
      "credential": { "platform": "netease", "state": "anonymous", "fingerprint": "", "hasMemberKey": false }
    }
  ]
}
```

`state` 为 `configured` | `anonymous`；`hasMemberKey` 表示 cookie 里是否有会员语义的键（网易云 `MUSIC_U`、QQ `qm_keyst`/`qqmusic_key`）。

### `GET /api/search`

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `q` | 是 | — | 关键词 |
| `platform` | 否 | `all` | `all` / `netease` / `qq` |
| `limit` | 否 | 20 | 每平台条数，1–50 |
| `offset` | 否 | 0 | 偏移（QQ 会换算成页码） |

```json
{
  "query": "晴天",
  "offset": 0,
  "limit": 20,
  "counts": { "netease": 20, "qq": 20 },
  "totals": { "netease": 305, "qq": 600 },
  "tracks": [ /* Track[]，按平台交替穿插 */ ],
  "degraded": { "platforms": ["qq"], "reasons": { "qq": "qq 后端不可达：fetch failed" } }
}
```

- `tracks` 按 `netease[0], qq[0], netease[1], qq[1] …` 交替排列，便于同时看到两个来源。
- 只有一个平台可用时仍返回 200，失败方出现在 `degraded`。
- 两个平台都失败时返回对应的上游错误（502）。

### `GET /api/search/suggest?q=`

返回最多 8 条联想词（基于搜索结果的「歌名 - 歌手」）。

### `GET /api/track/:id`

返回 `{ "track": Track }`。

### `GET /api/track/:id/url?quality=`

```json
{
  "trackId": "netease:2652820720",
  "url": "/api/stream/netease:2652820720?quality=hires",
  "requestedQuality": "hires",
  "quality": "high",
  "qualityLabel": "高品质 320k",
  "degraded": { "from": "hires", "to": "high", "reason": "Hi-Res 当前不可得，已降为 高品质 320k" },
  "size": 11161644,
  "br": 320000,
  "expiresAt": 1790409045433
}
```

- **`url` 永远指向本网关**，平台 CDN 地址不下发到浏览器。
- `quality` 是实际拿到的档位；与 `requestedQuality` 不同时给出 `degraded`。
- 播放地址缓存 30 分钟，命中缓存时也会重新计算 `degraded`。

### `GET /api/track/:id/lyric`

```json
{ "trackId": "qq:0039MnYb0qxYhV", "lrc": "[ti:晴天]\n…", "translated": "" }
```

`lrc` / `translated` 都是原始 LRC 文本，由前端解析。

### `GET /api/stream/:id?quality=`

**音频代理**：

- 透传请求的 `Range` / `If-Range`，响应原样带回 `206 Partial Content` 与 `Content-Range`，因此前端拖动进度条可用。
- 会返回 `Accept-Ranges: bytes`、`X-Quality`（实际档位）、`Cache-Control: no-store`。
- 上游（平台 CDN）返回 403/404 时，会丢弃缓存重新解析地址并重试一次；仍失败返回 410。
- 音频请求不经本地限速队列（顺序读取量大），只受 30s 超时约束。

### `GET /api/playlist/:id`

`id` 形如 `netease:3778678` 或 `qq:7614366897`。

```json
{
  "id": "netease:3778678",
  "platform": "netease",
  "name": "热歌榜",
  "coverUrl": "https://p1.music.126.net/…",
  "tracks": [ /* Track[] */ ]
}
```

QQ 部分歌单对匿名身份不可见，会返回 404，message 里带上游原因（如 `check privacy error!`）。

### `GET /api/recommend/daily?limit=30&platform=all`

```json
{
  "tracks": [ /* 两平台合并后的平铺列表 */ ],
  "sections": [
    { "platform": "netease", "title": "网易云每日推荐", "tracks": [], "source": "网易云每日推荐" },
    {
      "platform": "qq",
      "title": "QQ 音乐热歌",
      "tracks": [],
      "playlistId": "qq:8165221528",
      "source": "QQ 无匿名每日推荐，退化为热歌歌单「…」"
    }
  ],
  "degraded": { "platforms": [], "reasons": {} }
}
```

**已知偏差**：QQ 没有面向匿名的「每日推荐」接口，这里退化为它的公开热歌歌单，`source` 字段如实说明，`playlistId` 可用于跳转完整歌单。网易云 `/recommend/songs` 匿名可用，返回 `dailySongs`。

### `GET /api/recommend/similar?seed=netease:123`

以某首歌的歌手为种子在同平台再搜一次，用于「相似推荐」。

### 凭证与登录

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/credentials/status` | 返回 `{ platforms: CredentialStatus[] }` |
| `POST` | `/api/credentials/qq` | body `{ "cookie": "…" }`，空串表示清除 |
| `POST` | `/api/credentials/netease` | 同上，手填兜底入口 |
| `POST` | `/api/login/netease/qr` | 返回 `{ key, qrimg, qrurl }`，`qrimg` 是 dataURL |
| `GET` | `/api/login/netease/qr/check?key=` | `{ code, state, message, status? }`，`state` = `waiting`/`scanned`/`expired`/`confirmed` |
| `DELETE` | `/api/login/netease` | 退出网易云登录 |

`POST /api/credentials/qq` 的响应：

```json
{ "ok": true, "status": { "platform": "qq", "state": "configured", "fingerprint": "4ff77356", "hasMemberKey": true }, "hasUin": true, "upstreamReachable": true }
```

- 服务端会校验 cookie 长度与 `=` 的存在性，过长或明显不是键值对会返回 400。
- 写入后同步到 `apps/gateway/.qq-cookie.txt`，供打了补丁的 QQ 后端热读取（1 秒缓存，无需重启）。
- 扫码确认（`code=803`）时上游把 cookie 放在**响应体**里（不是 `Set-Cookie`），网关在服务端接住并落盘，同时剔除 `Max-Age`/`Path` 等属性段。未确认时上游返回的临时 cookie（`NMTID` 等）会被丢弃。

## 类型

```ts
interface Track {
  id: string;                    // 平台:平台曲目id
  platform: 'netease' | 'qq';
  platformTrackId: string;
  title: string;
  artists: { id?: string; name: string }[];
  album: { id?: string; name: string; coverUrl?: string };
  durationMs: number;
  qualities: Quality[];          // 平台元数据声明的可用档位
}

interface Quality { level: QualityLevel; label: string; br?: number; ext?: string; size?: number }
```

`qualities` 来自平台元数据（「这首歌有什么档位」），而 `/api/track/:id/url` 的 `quality` 是「当前身份实际拿到了什么档位」——两者可能不同，例如匿名身份请求无损会拿到 320k。

## 前端本地存储

浏览器端只用 `localStorage`，键前缀 `webmuic:`：

| 键 | 内容 |
| --- | --- |
| `webmuic:settings` | 音质、平台过滤、每页条数、音量、静音、歌词翻译开关 |
| `webmuic:queue` | 播放队列与当前下标 |
| `webmuic:favorites` | 收藏曲目 |
| `webmuic:lastQuery` | 上次搜索关键词 |

**凭证绝不进入 localStorage**：QQ cookie 只在提交时经过内存一次，提交后立即清空。
