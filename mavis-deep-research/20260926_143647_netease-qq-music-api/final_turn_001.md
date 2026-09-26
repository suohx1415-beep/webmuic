# 网易云音乐与 QQ 音乐第三方接口调研：项目谱系、可用性与会员凭证边界

两个平台的第三方接口目前处在完全不同的生命周期阶段。网易云音乐曾有一个事实标准级的开源接口服务，2024 年 4 月该仓库被作者清空并转为只读，此后生态转入 fork 与语言移植的分散生存状态【1】【2】【3】；QQ 音乐从未出现同等量级的旗舰项目，可用库规模小、登录模块普遍缺位，调用者必须自行处理请求签名与播放凭证【18】【21】。对同时持有双方会员的使用者而言，会员资格并不能直接兑换成第三方接口的稳定性：接口能取到什么音质，取决于登录凭证能否通过平台风控，而这是整条链路上最容易失效的一环。

## 一、两个平台第三方接口生态的结构差异

需要先把“解析接口”和“官方 API”分开。前者指复现客户端或网页端加密协议、再聚合成 HTTP 服务的逆向产物；后者是平台审核后发放的合作能力。两者在授权、稳定性与音质上限上不在同一个层面，网络讨论里却常被混用。官方开放平台的定位是“将歌单、个性化推荐、评论、播客等核心能力通过接口开放给合作方，用于各类设备上的应用”【25】，这与第三方项目复现前端请求是两件事。

另一个常被忽略的结构事实是：这类方案分成接口服务层（提供数据与播放链接的后端）和客户端层（播放器外壳）。客户端失效往往快于接口，外壳依赖的接口只要变动一次，整个客户端就不可用；而接口层即使上游仓库停止维护，fork 与移植版仍可能继续存在一段时间。这个“壳易死、接口相对长寿”的差别，决定了选型时注意力应该放在接口层，而不是界面更精致的播放器。

两个平台的差异也来自同一个原因。网易云在 2020 年前后形成了单点旗舰，所以它的消亡是删库式事件，留下大量 fork；QQ 音乐没有形成单点旗舰，生态是若干小项目各自维护，因此不会有戏剧性的删库，但每个项目的完成度与维护持续性都更弱。这直接决定了后文的调查重点：网易云侧看 fork 与协议复现，QQ 音乐侧看签名与凭证。

## 二、网易云音乐第三方接口项目谱系

### 2.1 已归档的旗舰项目与加密协议层

旗舰项目是 Binaryify/NeteaseCloudMusicApi，Node.js 实现，曾覆盖登录、歌单、评论、搜索、播放链接等几乎全部业务接口。它的当前状态可以直接核实：仓库被作者归档并转为只读，页面仅保留一份 README，公开数据是 30.3k stars 与 15.9k forks【1】；媒体报道称作者出于版权原因删库停更【2】，中文技术社区则记录了“开源仓库已清空”的过程【3】。npm 上的同名包仍可安装，属于历史版本的残留分发【4】。

这个项目难以被简单替代的原因在于它复刻了网易云的整套握手协议。Web 端接口 weapi 的 params 经过两次 AES 加密，另配一个用 RSA 生成的 encSecKey 参数【9】；客户端接口 eapi 使用 AES-128-ECB 加密，密钥在公开的逆向记录中已经给出【10】。Rust 移植版 ncm-api-rs 在文档中直接标注同时支持 weapi、eapi、linuxapi 三种加密方式【5】，说明协议层实现已被多方重复。此外，Go 语言有 chaunsin/netease-cloud-music【6】，Rust 另有 gmg137/netease-cloud-music-api【7】，Go 的 AMLX-MUSIC-API 把加密层单独放在 netease 目录下【8】。

下表把网易云一侧的项目按“接口服务—代理—客户端”三层排列，重点看它们的当前状态与依赖关系。

| 项目 | 形态与语言 | 当前状态 | 能力与依赖 |
| --- | --- | --- | --- |
| Binaryify/NeteaseCloudMusicApi | Node.js 接口服务 | 已归档（只读，2024-04-16），仅存 README | 覆盖登录、歌单、评论、搜索、播放链接；复现 weapi 与 eapi【1】【3】【9】【10】 |
| ncm-api-rs | Rust 接口服务 | 存在，维护状态未核实 | 声明支持 weapi、eapi、linuxapi【5】 |
| gmg137/netease-cloud-music-api | Rust 接口服务 | 存在，维护状态未核实 | 同族 Rust 移植【7】 |
| chaunsin/netease-cloud-music | Go 接口服务 | 存在，维护状态未核实 | Go 实现【6】 |
| AMLX-MUSIC-API | Go 接口服务 | 存在，维护状态未核实 | netease/crypto.go 单独实现加密层【8】 |
| UnblockNeteaseMusic 与 luci 插件 | 代理与路由器插件 | 存在 | 将变灰歌曲替换为其他平台音源，含 OpenWrt 插件【11】【12】【13】 |
| YesPlayMusic | Vue 与 Electron 客户端 | 存在（33.3k stars，MIT） | 界面层，需另行自建接口服务【14】 |
| SPlayer | Electron 客户端 | 已归档（2026-07-17） | 依赖第三方 API 服务【15】【16】【17】 |

表中“已归档”只出现在两个位置，一个是接口层的源头，一个是客户端层的晚期项目；其余项目都还在，但缺少公开的维护证据。因此可用性判断不能只看仓库是否还在，而要看它是否还在跟进上游协议的变动。

### 2.2 代理式方案与客户端类项目

与“复现接口”并行的另一条路线是代理改写。UnblockNeteaseMusic 通过代理拦截客户端请求，把因版权下架而变灰的歌曲替换为其他平台（QQ、酷狗、酷我、百度、咪咕、JOOX 等）的同曲音源，并有配套的 OpenWrt 插件用于路由器侧部署【11】【12】。项目作者在说明中把边界写得很清楚，主要解决“变灰”而不是解锁会员专属内容【13】。

客户端层的代表是 YesPlayMusic，Vue 加 Electron 实现，33.3k stars、MIT 协议，界面完成度高，但它正常工作需要另行自建接口服务【14】。SPlayer 是更晚近的同类项目，7.4k stars、AGPL-3.0，仓库已被作者归档（2026 年 7 月 17 日）【15】；其讨论区长期存在关于第三方 API 服务的依赖讨论【16】，社区教程干脆把“自建 NeteaseCloudMusicApi 并指向 SPlayer”写成标准步骤【17】。三个案例指向同一判断：第三方播放器的价值在界面与体验，接口能力并不由它们提供，去掉后端都不能独立工作。

## 三、QQ音乐接口项目与请求签名机制

### 3.1 接口库清单与能力范围

QQ 音乐这边没有单一旗舰，可用的是几个规模有限、定位各异的库，下表汇总它们的能力与凭证处理方式。

| 项目 | 语言 | 登录与凭证处理 | 接口范围与限制 |
| --- | --- | --- | --- |
| Rain120/qq-music-api | Koa2 与 TypeScript | 无登录模块，仅支持自定义 cookie | 播放链接、歌单、排行榜、评论、MV 等；作者声明仅供学习、不可商用【18】 |
| UtoYuri/QQMusicApi | PHP、Python | 未提供登录流程 | search、artist、song、album、playlist、source、lyric【19】 |
| L-1124/QQMusicApi | Python（异步） | 未提供登录流程 | 常见接口封装，GPL-3.0，标注仅用于技术探索【20】 |
| copws/qq-music-api | JavaScript | 未提供登录流程 | 取播放链接（m4a、128、320）、歌单、搜索、歌词；作者建议挂代理【21】 |

这张表里最一致的一列是“登录与凭证处理”：四个项目都没有提供完整的登录流程。这意味着 QQ 音乐侧的实际门槛不在“有没有库”，而在凭证怎么来、签名怎么算，下面单独说明。

### 3.2 请求签名与播放凭证

QQ 音乐网页端对请求做了签名校验，算法代号 zzc，另有一套 ag-1 加密。公开的逆向记录指出，签名输出长度不固定，但相同输入会产生相同输出，说明它不是简单的定长哈希【22】；目前有可直接引用的实现库 qmweb-sign，包含 Node 版本以及 zzc_sign.py、ag1_cipher.py 两个 Python 参考实现【23】。播放链接则不是一次请求就能拿到，需要向 musicu.fcg 提交请求，从响应的 midurlinfo 中取出 purl，再与 vkey、guid、uin 拼接成完整地址【24】。

音质通过请求中的文件名前缀区分，这是调用时最需要对照的一组参数。四种格式需要分别发起请求，再按优先级取用【24】。

| 文件名前缀 | 后缀 | 对应音质 | 典型体积 |
| --- | --- | --- | --- |
| F000 | .flac | 无损 FLAC | 约 30 MB |
| M800 | .mp3 | 高品质 320 kbps | 约 10 MB |
| M500 | .mp3 | 标准 128 kbps | 约 4 MB |
| C400 | .m4a | AAC | 约 3 MB |

前缀表的意义在于它把“音质”变成了请求参数而不是账号特权的一部分：接口本身可以把 F000 写进请求，但能否收到可用的 purl，仍要回到凭证与风控上判断。这也解释了 QQ 音乐侧为什么项目更少、更不完整，签名算法、vkey 请求、格式前缀、平台校验四件事都要调用者自己实现。

## 四、会员凭证与音质能力的边界

会员在这里的作用是授信，不是绕权。第三方接口并没有破解会员体系，它复现的是带登录态的请求：QQ 音乐的 purl 上挂载 vkey 与 uin、guid，音质上限取决于凭证对应的账号态【24】；网易云侧的 weapi 与 eapi 同样以登录 cookie 为前提【9】。聚合类客户端把这个边界写得更直白，MusicFree 的插件机制官方声明并不具备任何“破解 VIP 会员”的能力，版权音乐仍需付费【30】。

由此可以解释一个常见困惑：既然有会员，为什么接口还是拿不到无损。多数失败发生在风控层而不是算法层。第三方客户端的请求频率、IP 归属与官方客户端差异明显，MusicFree 的说明中提到频繁下载或反复切换音源会导致 IP 被封【30】；LX Music 的音源脚本可以声明 128k、320k、flac、flac24bit 四档音质【27】，但脚本声明的是“可尝试获取”的范围，能否真正取到仍由账号态与风控决定，两者不是一回事。把“接口支持”与“账号能取到”分开理解，是判断这类方案是否值得投入的前提。

## 五、官方开放平台与聚合客户端的替代路径

### 5.1 官方开放平台

网易云的官方路径是 developer.music.163.com。文档中心区分厂商接入与个人接入两条指南，能力上分音乐 API、播客 API、定制 API、SDK、CMAPI 与网易云音认证；接入流程包含开发者入驻、创建应用、生成密钥并上传、应用管理、应用签名（Java、Python、Android 与 iOS）、上线流程、播放上报测试用例，以及数据验收后发布上线【25】。这是一条需要审核的合作路径，与面向个人、装上即用的第三方接口不是同一类东西。网络上流传的“网易云音乐 API 开放平台访问 token 分步指南”实际描述的是注册开放平台、申请 APP ID、账号入驻的流程【26】，可作为入驻路径的参考，但它属于服务商门户的转述，与第三方逆向项目没有关系。

QQ 音乐这一侧的官方能力更模糊。可以看到聚合平台对“QQ音乐开发者平台”的转述，列举登录鉴权、SDK、OpenAPI、APP 互联与车机解决方案等模块【34】；在可查到的公开资料中没有找到面向个人开发者开放音乐数据接口的官方入口，这一点按未证实处理。

### 5.2 插件化聚合客户端

对个人使用最现实的一层是插件化聚合客户端。它们的共同做法是客户端只做界面与播放器，取源能力交给可替换的脚本，因此抗失效性来自换源而不是等更新。

LX Music（洛雪音乐）的结构最清楚。它提供自定义源脚本机制，脚本按源注册，源 key 为 kw、kg、tx、wy、mg、local，每个源声明支持的动作（musicUrl、lyric、pic）与音质档位（128k、320k、flac、flac24bit）【27】；从 v1.17.0 起还支持通过 lxmusic:// 形式的 Scheme URL 被浏览器等外部程序唤起播放【28】。洛雪音乐本体已经因为收到律师函而下线内置的各大平台接口，只保留自定义音源能力，功能靠使用者自行导入的源脚本维持【29】。MusicFree 走类似的插件路线，支持网易云、QQ 音乐、酷狗、酷我、咪咕、全民K歌等来源【30】。Listen1 则是较早的聚合方案，支持网易云音乐、QQ 音乐、酷狗、酷我、Bilibili 与咪咕【31】。

## 六、风险边界与选型建议

协议层面的风险是明确存在的。网易系服务协议把“使用插件、外挂或非经授权的第三方工具、服务、系统接入本服务和相关系统”以及“对本服务运行过程中客户端与服务器端的交互数据进行复制、修改、增加、删除、挂接运行”列为禁止行为【32】；社区行为规范进一步列出不予注册、禁言、封禁、关闭或回收账号、列入黑名单等处置手段，其中封禁期间无法登录和使用全部服务，多次违规可升级为永久封禁【33】。同一份协议还明确，通过非官方渠道获取或充值的账号不予承认【32】。第三方客户端导致具体账号被封的公开确证案例在可查范围内没有找到，但条款已经给出处置依据，实际风险取决于平台的风控判断。

把前述结构差异落到选择上，大致分四种情形：

- 只在电脑或手机上听歌：用插件化聚合客户端（LX Music、MusicFree），成本最低，代价是音源会周期性失效，需要自己维护一份可用源列表。
- 需要自建服务或做二次开发：网易云侧用 fork 或移植版接口服务自建部署，Node、Rust、Go 均有实现【5】【6】；QQ 音乐侧用 L-1124 或 Rain120 的库，并自行补齐 zzc 签名与 vkey 请求【18】【20】【23】。
- 需要合规且能被长期依赖：走官方开放平台，接受入驻审核、应用签名与播放上报的流程要求【25】。
- 只想要更高音质：优先确认凭证而不是更换项目，vkey 与 cookie 的账号态决定了音质上限，换接口并不会突破它【24】【30】。

在所有这些路径里，会员资格的真实作用是提供更高音质的凭证前提，而不是提供接口的稳定性。第三方接口的可用性由三件事共同决定：上游仓库是否存续、签名算法是否变动、平台风控是否收紧，这三件事都不在使用者的控制范围内。把方案设计成“接口可替换、凭证本地保存、请求频率可控”，比选定某个具体项目更接近可用的答案。

## 参考来源

1. Binaryify/NeteaseCloudMusicApi 仓库主页 — https://github.com/Binaryify/NeteaseCloudMusicApi
2. 出于“保护版权”，网易云音乐第三方开源API GitHub删库停更（凤凰网） — https://tech.ifeng.com/c/8WbVMJIGASL
3. 再见，网易云API，开源仓库已清空！（知乎） — https://zhuanlan.zhihu.com/p/704662896
4. NeteaseCloudMusicApi（npm 包页） — https://www.npmjs.com/package/NeteaseCloudMusicApi
5. ncm_api_rs（Rust 文档） — https://docs.rs/ncm-api-rs
6. chaunsin/netease-cloud-music 的 CLAUDE.md — https://github.com/chaunsin/netease-cloud-music/blob/master/CLAUDE.md
7. gmg137/netease-cloud-music-api 的 AGENTS.md — https://github.com/gmg137/netease-cloud-music-api/blob/master/AGENTS.md
8. AMLX-MUSIC-API 的 netease/crypto.go — https://github.com/xiaowumin-mark/AMLX-MUSIC-API/blob/main/netease/crypto.go
9. 网易云音乐API分析（humingk 的技术博客） — https://humingk.github.io/python-netease_music
10. 网易云音乐 EAPI 中 cache_key 参数分析（Rocka's Blog） — https://rocka.me/article/netease-cloud-music-cache-key-reverse
11. [OpenWrt] 解除网易云音乐播放限制（luci-app-unblockneteasemusic） — https://github.com/UnblockNeteaseMusic/luci-app-unblockneteasemusic
12. 网易云音乐破版权服务（July's Blog） — https://yangwenqing.com/archives/682
13. 解锁网易云音乐的灰色歌曲、会员歌曲（Mirari's Blog） — https://mirari.cc/posts/2020-04-02-unlocking_grayed_out_songs_and_member_songs_on_netease_cloud_music
14. qier222/YesPlayMusic 仓库主页 — https://github.com/qier222/YesPlayMusic
15. SPlayer-Dev/SPlayer 仓库主页 — https://github.com/SPlayer-Dev/SPlayer
16. NeteaseCloudMusicApi停止维护（SPlayer Discussion #151） — https://github.com/SPlayer-Dev/SPlayer/discussions/151
17. SPlayer 与 NeteaseCloudMusicApi 自建部署说明 — https://blog.zrf.me/p/SPlayer-NeteaseCloudMusicApi/index.html
18. Rain120/qq-music-api 仓库主页 — https://github.com/Rain120/qq-music-api
19. UtoYuri/QQMusicApi 仓库主页 — https://github.com/UtoYuri/QQMusicApi
20. L-1124/QQMusicApi 仓库主页 — https://github.com/L-1124/QQMusicApi
21. copws/qq-music-api 仓库主页 — https://github.com/copws/qq-music-api
22. 对抗 QQ 音乐网页端的请求签名（zzc + ag-1，Jixun's Blog） — https://jixun.uk/posts/2024/qqmusic-zzc-sign
23. jixunmoe/qmweb-sign 仓库主页 — https://github.com/jixunmoe/qmweb-sign
24. QQ音乐播放接口：PHP逆向分析与实现（小野博客） — https://lb5.net/257.html
25. 网易云音乐开放平台文档中心 — https://developer.music.163.com/st/developer/document
26. 网易云音乐API开放平台访问token分步指南（幂简集成） — https://www.explinks.com/blog/wa-step-by-step-guide-to-obtain-access-token-for-netease-cloud-music-api-open-platform
27. 自定义源脚本编写说明（LX Music 官方文档） — https://lxmusic.toside.cn/desktop/custom-source
28. LX Music 桌面版说明（LX Music 官方文档） — https://lxmusic.toside.cn/desktop
29. 洛雪音乐限定复活 - 自定义音源（YttriumWillow，博客园） — https://www.cnblogs.com/YttriumWillow/p/18385086/lx-music
30. MusicFree 开源网络音乐聚合播放器（异次元软件世界） — https://www.iplaysoft.com/musicfree.html
31. Listen 1 音乐播放器 — https://listen1.github.io/listen1
32. 网易天音服务协议（网易云音乐账号体系服务条款） — https://tianyin.music.163.com/terms/user-agreement
33. 网易云音乐社区行为规范 — http://music.163.com/rules
34. 全面解读 QQ音乐 API 服务商（幂简集成，聚合平台转述） — https://www.explinks.com/provider/uid2024041769791b28f0d0
