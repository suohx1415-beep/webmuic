<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { QrCheckResponse, QrSession } from '@/api/types';
import { PLATFORM_LABELS } from '@/format';
import { useAuthStore } from '@/stores/auth';
import { useFavoritesStore } from '@/stores/favorites';
import { usePlayerStore } from '@/stores/player';
import { QUALITY_OPTIONS, useSettingsStore } from '@/stores/settings';

const emit = defineEmits<{ notify: [message: string] }>();

const auth = useAuthStore();
const settings = useSettingsStore();
const player = usePlayerStore();
const favorites = useFavoritesStore();

const qr = ref<QrSession | null>(null);
const qrState = ref<QrCheckResponse['state'] | ''>('');
const qrMessage = ref('');
const qrLoading = ref(false);
let pollTimer: number | undefined;

const qqStatus = computed(() => auth.statusOf('qq'));
const neteaseStatus = computed(() => auth.statusOf('netease'));

const qrStateText = computed(
  () =>
    ({
      waiting: '等待扫码',
      scanned: '已扫码，请在手机上确认',
      confirmed: '登录成功',
      expired: '二维码已过期，请重新获取',
    })[qrState.value as string] ?? '',
);

function stopPolling(): void {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

async function startQr(): Promise<void> {
  qrLoading.value = true;
  auth.error = '';
  try {
    qr.value = await api.createNeteaseQr();
    qrState.value = 'waiting';
    qrMessage.value = '';
    stopPolling();
    pollTimer = window.setInterval(async () => {
      if (!qr.value) return;
      try {
        const check = await api.checkNeteaseQr(qr.value.key);
        qrState.value = check.state;
        qrMessage.value = check.message;
        if (check.state === 'confirmed') {
          stopPolling();
          qr.value = null;
          await auth.refresh();
          emit('notify', '网易云登录成功，凭证已保存在网关');
        } else if (check.state === 'expired') {
          stopPolling();
        }
      } catch (e) {
        stopPolling();
        qrMessage.value = e instanceof ApiError ? e.message : '轮询失败';
      }
    }, 2500);
  } catch (e) {
    auth.error = e instanceof ApiError ? e.message : '二维码获取失败';
  } finally {
    qrLoading.value = false;
  }
}

async function saveQq(): Promise<void> {
  const ok = await auth.submitQqCookie();
  emit('notify', ok ? 'QQ cookie 已提交给网关（页面不再保留明文）' : 'QQ cookie 保存失败');
}

function resetSettings(): void {
  settings.reset();
  emit('notify', '已恢复默认偏好');
}

function clearLocalData(): void {
  player.clearQueue();
  favorites.clear();
  emit('notify', '已清空队列与收藏');
}

onMounted(() => {
  void auth.refresh();
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <h1 class="page-title">设置</h1>
  <p class="page-sub">
    平台凭证只保存在网关的 <code>apps/gateway/.env.local</code>（权限 600、已被 gitignore）。页面永远不会回显 cookie 明文。
  </p>

  <div v-if="auth.error" class="notice error">{{ auth.error }}</div>
  <div v-if="auth.notice" class="notice ok">{{ auth.notice }}</div>

  <section class="card" style="margin-bottom: 18px">
    <h2 style="margin: 0 0 12px; font-size: 16px">播放偏好</h2>
    <div class="row wrap">
      <label style="min-width: 220px">
        <div class="small muted">音质</div>
        <select v-model="settings.quality">
          <option v-for="opt in QUALITY_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}（{{ opt.hint }}）
          </option>
        </select>
      </label>
      <label style="min-width: 160px">
        <div class="small muted">搜索范围</div>
        <select v-model="settings.platform">
          <option value="all">全部平台</option>
          <option value="netease">仅网易云</option>
          <option value="qq">仅 QQ 音乐</option>
        </select>
      </label>
      <label style="min-width: 120px">
        <div class="small muted">每页条数</div>
        <input v-model.number="settings.limit" type="number" min="5" max="50" />
      </label>
    </div>
    <label class="row" style="margin-top: 12px">
      <input type="checkbox" v-model="settings.showTranslation" style="width: auto" />
      <span>歌词显示翻译</span>
    </label>
    <div class="row" style="margin-top: 14px">
      <button @click="resetSettings">恢复默认</button>
    </div>
    <p class="small muted" style="margin: 10px 0 0">
      无损与 Hi-Res 需要对应平台的会员凭证；匿名状态下网关会自动降级到能拿到的最高档位，并在播放条上提示。
    </p>
  </section>

  <section class="card" style="margin-bottom: 18px">
    <h2 style="margin: 0 0 12px; font-size: 16px">平台凭证状态</h2>
    <div v-for="status in auth.statuses" :key="status.platform" class="row" style="margin-bottom: 8px">
      <span style="width: 80px">{{ PLATFORM_LABELS[status.platform] }}</span>
      <span class="badge" :class="status.platform">{{ status.state === 'configured' ? (status.hasMemberKey ? '已登录' : '已配置') : '匿名' }}</span>
      <span v-if="status.fingerprint" class="small muted">指纹 {{ status.fingerprint }}</span>
      <span class="spacer" />
      <span
        v-if="auth.healthOf(status.platform)"
        class="small"
        :class="auth.healthOf(status.platform)?.reachable ? 'muted' : ''"
        :style="auth.healthOf(status.platform)?.reachable ? '' : 'color: var(--warn)'"
      >
        {{ auth.healthOf(status.platform)?.reachable ? `后端正常 · ${auth.healthOf(status.platform)?.latencyMs}ms` : '后端不可达' }}
      </span>
    </div>
    <button class="ghost" @click="auth.refresh()">刷新状态</button>
  </section>

  <section class="card" style="margin-bottom: 18px">
    <h2 style="margin: 0 0 12px; font-size: 16px">网易云登录（扫码）</h2>
    <div v-if="qr" class="qr-wrap">
      <img :src="qr.qrimg" alt="二维码" />
      <div>
        <p style="margin: 0 0 6px">用网易云音乐 App 扫码登录。</p>
        <p class="small muted" style="margin: 0 0 6px">
          cookie 由网关在服务端接住并落盘，浏览器全程看不到明文。
        </p>
        <p class="small" style="color: var(--warn)">{{ qrStateText }} {{ qrMessage }}</p>
      </div>
    </div>
    <div class="row">
      <button class="primary" :disabled="qrLoading" @click="startQr">
        {{ qrLoading ? '获取中…' : qr ? '重新获取二维码' : '生成登录二维码' }}
      </button>
      <button v-if="neteaseStatus.state === 'configured'" @click="auth.logoutNetease()">退出网易云登录</button>
    </div>
  </section>

  <section class="card" style="margin-bottom: 18px">
    <h2 style="margin: 0 0 12px; font-size: 16px">QQ 音乐凭证（手填 cookie）</h2>
    <p class="small muted" style="margin: 0 0 10px">
      本项目不实现 QQ 扫码登录。请从浏览器开发者工具里复制 <code>y.qq.com</code> 的完整 cookie（建议包含
      <code>qm_keyst</code> 与 <code>uin</code>）。粘贴后点保存：内容只经一次 POST 送往网关，随后立即从页面内存中清除，不会写入 localStorage。
    </p>
    <textarea
      v-model="auth.qqCookieDraft"
      rows="3"
      placeholder="uin=o...; qm_keyst=...; qqmusic_key=...;"
    />
    <div class="row" style="margin-top: 10px">
      <button class="primary" :disabled="auth.qqSubmitting" @click="saveQq">
        {{ auth.qqSubmitting ? '提交中…' : '保存到网关' }}
      </button>
      <button :disabled="qqStatus.state !== 'configured'" @click="auth.clearQqCookie()">清除 QQ 凭证</button>
      <span class="small muted">
        当前：{{ qqStatus.state === 'configured' ? (qqStatus.hasMemberKey ? '已配置会员 key' : '已配置（无会员 key）') : '匿名' }}
      </span>
    </div>
    <p v-if="qqStatus.state === 'anonymous'" class="small muted" style="margin: 10px 0 0">
      匿名状态下 QQ 侧只能播放非会员曲目，会员曲会返回「暂无可用播放地址」。
    </p>
  </section>

  <section class="card">
    <h2 style="margin: 0 0 12px; font-size: 16px">本地数据</h2>
    <p class="small muted" style="margin: 0 0 10px">
      队列、收藏、偏好都保存在浏览器 localStorage，刷新不会丢；清空后无法恢复。
    </p>
    <button @click="clearLocalData">清空队列与收藏</button>
  </section>
</template>
