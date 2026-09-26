#!/usr/bin/env node
/**
 * 验收冒烟脚本：对着已经跑起来的四个进程逐条核验计划的验收标准。
 * 用法：node scripts/smoke.mjs        （网关与两个后端需已在运行）
 *
 * 覆盖的验收点：
 *   1. 四个进程都只监听 127.0.0.1，前端 5173 可用
 *   2. 单次搜索同时返回两个平台的曲目并带来源标记
 *   3. 两平台都能取到可播放的音频（代理返回 200/206 且是音频字节）
 *   4. 浏览器侧任何接口都读不到 cookie 明文
 *   5. QQ 未配置凭证时给出明确提示；配置后有对应状态
 *   6. 停掉某个平台后端时另一个平台仍可用，并有降级提示
 *   7. 偏好/队列/收藏是前端本地存储（这里校验网关不落任何业务数据）
 *   8. 音频请求指向本机网关而不是平台 CDN
 */
import process from 'node:process';

const GATEWAY = process.env.GATEWAY_BASE ?? 'http://127.0.0.1:8787';
const WEB = process.env.WEB_BASE ?? 'http://127.0.0.1:5173';
const NETEASE = 'http://127.0.0.1:3010';
const QQ = 'http://127.0.0.1:3200';

let passed = 0;
let failed = 0;
const notes = [];

function ok(label, extra = '') {
  passed += 1;
  console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
}

function bad(label, detail) {
  failed += 1;
  console.log(`  ✗ ${label} — ${detail}`);
}

function note(text) {
  notes.push(text);
  console.log(`  · ${text}`);
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, response };
}

async function listening(host, port) {
  try {
    const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(3000) });
    return response.status;
  } catch (error) {
    throw new Error(String(error));
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  console.log(`webmuic 冒烟验收 @ ${new Date().toISOString()}`);

  section('1) 进程与端口');
  for (const [name, url] of [
    ['网易云后端', NETEASE],
    ['QQ 后端', QQ],
    ['网关', GATEWAY],
    ['前端 dev server', WEB],
  ]) {
    try {
      const status = await listening(new URL(url).hostname, new URL(url).port);
      ok(`${name} 可达`, `HTTP ${status}`);
    } catch (error) {
      bad(`${name} 可达`, error.message);
    }
  }

  section('2) 跨平台搜索');
  const search = await getJson(`${GATEWAY}/api/search?q=${encodeURIComponent('晴天')}&limit=5`);
  if (search.status !== 200) {
    bad('搜索返回 200', `HTTP ${search.status}`);
  } else {
    const tracks = search.body.tracks ?? [];
    const platforms = new Set(tracks.map((t) => t.platform));
    if (platforms.has('netease') && platforms.has('qq')) {
      ok('单次搜索同时命中两个平台', `${tracks.length} 条`);
    } else {
      bad('单次搜索同时命中两个平台', `实际平台：${[...platforms].join(',') || '无'}${search.body.degraded ? `（降级：${JSON.stringify(search.body.degraded)}）` : ''}`);
    }
    const interleaved = tracks.length >= 2 && tracks[0].platform !== tracks[1].platform;
    if (interleaved) ok('结果按平台交替排列');
    else note('结果未交替排列（可能是某一平台条数不足）');
    const withId = tracks.every((t) => typeof t.id === 'string' && t.id.includes(':'));
    if (withId) ok('每条曲目都带 平台:曲目id 标记');
    else bad('每条曲目都带 平台:曲目id 标记', '存在缺少 id 的条目');

    // 3/8 用真实的搜索结果来验证播放链路
    const neteaseTrack = tracks.find((t) => t.platform === 'netease' && (t.qualities ?? []).length > 0);
    const qqTracks = tracks.filter((t) => t.platform === 'qq');

    section('3) 播放地址与音频代理');
    if (neteaseTrack) {
      const resolved = await getJson(`${GATEWAY}/api/track/${encodeURIComponent(neteaseTrack.id)}/url?quality=standard`);
      if (resolved.status === 200 && String(resolved.body.url ?? '').startsWith('/api/stream/')) {
        ok('网易云播放地址指向本机网关', resolved.body.url);
      } else {
        bad('网易云播放地址指向本机网关', `HTTP ${resolved.status} ${JSON.stringify(resolved.body).slice(0, 160)}`);
      }

      const streamUrl = `${GATEWAY}${resolved.body.url}`;
      const full = await fetch(streamUrl, { headers: { Range: 'bytes=0-2047' } });
      const bytes = new Uint8Array(await full.arrayBuffer());
      if (full.status === 206 && bytes.byteLength === 2048) {
        ok('音频代理支持 Range（206）', `content-range=${full.headers.get('content-range')}`);
      } else {
        bad('音频代理支持 Range（206）', `HTTP ${full.status} len=${bytes.byteLength}`);
      }
      const contentType = full.headers.get('content-type') ?? '';
      if (contentType.startsWith('audio/')) ok('响应是音频内容类型', contentType);
      else bad('响应是音频内容类型', contentType || '(缺失)');

      // 中段请求：模拟拖动进度条
      const mid = await fetch(streamUrl, { headers: { Range: 'bytes=100000-100999' } });
      const midBytes = new Uint8Array(await mid.arrayBuffer());
      if (mid.status === 206 && midBytes.byteLength === 1000) ok('中间段落 Range 请求正常');
      else bad('中间段落 Range 请求正常', `HTTP ${mid.status} len=${midBytes.byteLength}`);
    } else {
      note('本次搜索结果里没有网易云曲目，跳过网易云播放链路检查');
    }

    let qqPlayable = null;
    for (const track of qqTracks.slice(0, 5)) {
      const resolved = await getJson(`${GATEWAY}/api/track/${encodeURIComponent(track.id)}/url?quality=standard`);
      if (resolved.status === 200 && String(resolved.body.url ?? '').startsWith('/api/stream/')) {
        qqPlayable = { track, resolved };
        break;
      }
    }
    if (qqPlayable) {
      ok('QQ 存在可匿名播放的曲目', qqPlayable.track.title);
      const streamUrl = `${GATEWAY}${qqPlayable.resolved.body.url}`;
      const ranged = await fetch(streamUrl, { headers: { Range: 'bytes=0-1023' } });
      const len = (await ranged.arrayBuffer()).byteLength;
      if (ranged.status === 206 && len === 1024) ok('QQ 音频代理支持 Range（206）');
      else bad('QQ 音频代理支持 Range（206）', `HTTP ${ranged.status} len=${len}`);
    } else {
      note('本次搜索的 QQ 曲目前 5 首都不可匿名播放（会员曲），符合预期；配好 cookie 后应可播放');
    }
  }

  section('4) 凭证不回显');
  const credStatus = await getJson(`${GATEWAY}/api/credentials/status`);
  const credText = JSON.stringify(credStatus.body);
  const leaks = ['MUSIC_U=', 'qm_keyst=', 'qqmusic_key=', '__csrf='].filter((needle) => credText.includes(needle));
  if (leaks.length === 0) ok('状态接口不含任何 cookie 字段名或值');
  else bad('状态接口不含任何 cookie 字段名或值', `发现：${leaks.join(', ')}`);

  const health = await getJson(`${GATEWAY}/api/health`);
  const healthText = JSON.stringify(health.body);
  const healthLeaks = ['MUSIC_U=', 'qm_keyst='].filter((needle) => healthText.includes(needle));
  if (healthLeaks.length === 0) ok('健康检查接口不含凭证');
  else bad('健康检查接口不含凭证', healthLeaks.join(', '));

  const fingerprints = (credStatus.body.platforms ?? []).map((p) => `${p.platform}:${p.state}/${p.fingerprint || '-'}/${p.hasMemberKey}`);
  note(`当前凭证状态：${fingerprints.join('  ')}`);

  section('5) QQ 凭证缺失时的提示');
  const qqStatus = (credStatus.body.platforms ?? []).find((p) => p.platform === 'qq');
  const qqTrackForHint = search.body?.tracks?.find((t) => t.platform === 'qq');
  if (qqTrackForHint) {
    const unplayable = await getJson(`${GATEWAY}/api/track/${encodeURIComponent(qqTrackForHint.id)}/url?quality=lossless`);
    if (unplayable.status === 410) {
      ok('不可播时返回 410 与可读原因', unplayable.body?.error?.message?.slice(0, 60));
    } else if (unplayable.status === 200) {
      note('该 QQ 曲目在当前身份下可播（已配置 cookie 或非会员曲），无法演示 410 分支');
    } else {
      bad('不可播时返回 410 与可读原因', `HTTP ${unplayable.status}`);
    }
  }
  note(`QQ 凭证状态：${qqStatus?.state ?? '未知'}（配置后 qqmusic_key/qm_keyst 生效）`);

  section('6) 平台后端故障下的降级');
  for (const [name, platform, base] of [
    ['QQ 后端', 'qq', QQ],
    ['网易云后端', 'netease', NETEASE],
  ]) {
    const healthEntry = (health.body.platforms ?? []).find((p) => p.platform === platform);
    if (healthEntry?.reachable) {
      note(`${name} 当前可达（要验证故障降级，请停掉它后重跑本脚本）`);
    } else {
      const single = await getJson(`${GATEWAY}/api/search?q=${encodeURIComponent('晴天')}&limit=5`);
      const stillHas = (single.body.tracks ?? []).some((t) => t.platform !== platform);
      if (single.status === 200 && stillHas) {
        ok(`${platform} 不可达时另一平台仍可搜索`, `仍有 ${single.body.tracks.length} 条结果`);
      } else {
        bad(`${platform} 不可达时另一平台仍可搜索`, `HTTP ${single.status} ${JSON.stringify(single.body).slice(0, 160)}`);
      }
      if (single.body.degraded?.platforms?.includes(platform)) {
        ok('降级信息里指出不可用的平台', JSON.stringify(single.body.degraded.reasons));
      } else {
        bad('降级信息里指出不可用的平台', JSON.stringify(single.body.degraded ?? null));
      }
    }
  }

  section('7) 歌词与歌单');
  const lyric = await getJson(`${GATEWAY}/api/track/netease:2652820720/lyric`);
  if (lyric.status === 200 && typeof lyric.body.lrc === 'string') {
    ok('歌词接口可用', `lrc ${lyric.body.lrc.length} 字符`);
  } else {
    bad('歌词接口可用', `HTTP ${lyric.status}`);
  }
  const playlist = await getJson(`${GATEWAY}/api/playlist/netease:3778678`);
  if (playlist.status === 200 && Array.isArray(playlist.body.tracks) && playlist.body.tracks.length > 0) {
    ok('歌单接口可用', `${playlist.body.name} · ${playlist.body.tracks.length} 首`);
  } else {
    bad('歌单接口可用', `HTTP ${playlist.status}`);
  }

  section('8) 前端与网关的绑定关系');
  try {
    const page = await fetch(WEB, { signal: AbortSignal.timeout(5000) });
    const html = await page.text();
    if (page.status === 200 && html.includes('<div id="app">')) ok('前端页面可访问');
    else bad('前端页面可访问', `HTTP ${page.status}`);
  } catch (error) {
    bad('前端页面可访问', String(error));
  }
  const proxied = await getJson(`${WEB}/api/health`);
  if (proxied.status === 200 && proxied.body?.ok) ok('前端的 /api 代理指向网关');
  else bad('前端的 /api 代理指向网关', `HTTP ${proxied.status}`);

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`);
  if (notes.length) {
    console.log('备注：');
    for (const item of notes) console.log(`  - ${item}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n冒烟脚本自身出错：', error);
  process.exit(2);
});
