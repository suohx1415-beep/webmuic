<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { QrCheckResponse, QrSession } from '@/api/types';
import Icon from '@/components/Icon.vue';
import PlatformBadge from '@/components/PlatformBadge.vue';
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
let isCheckingNetease = false;
let neteaseFailCount = 0;

const qqQr = ref<QrSession | null>(null);
const qqQrState = ref<QrCheckResponse['state'] | ''>('');
const qqQrMessage = ref('');
const qqQrLoading = ref(false);
const qqQrType = ref<'qq' | 'wx'>('qq');
const showManualQqCookie = ref(false);
let qqPollTimer: number | undefined;
let isCheckingQq = false;
let qqFailCount = 0;

const qqStatus = computed(() => auth.statusOf('qq'));
const neteaseStatus = computed(() => auth.statusOf('netease'));

let isMounted = false;
let neteaseSessionId = 0;
let qqSessionId = 0;

const qrStateText = computed(
  () =>
    ({
      waiting: '等待扫码中...',
      scanned: '已扫码，请在手机客户端上确认',
      confirmed: '登录成功！',
      expired: '二维码已过期，请重新获取',
      failed: '扫码已取消或登录失败',
    })[qrState.value as string] ?? '',
);

const qqQrStateText = computed(
  () =>
    ({
      waiting: qqQrType.value === 'wx' ? '等待微信扫码中...' : '等待手机 QQ 扫码中...',
      scanned: qqQrType.value === 'wx' ? '已扫码，请在微信上确认' : '已扫码，请在手机 QQ 上确认',
      confirmed: '登录成功！',
      expired: '二维码已过期，请重新获取',
      failed: '扫码已取消或登录失败',
    })[qqQrState.value as string] ?? '',
);

function stopPolling(): void {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = undefined;
  isCheckingNetease = false;
  neteaseFailCount = 0;
}

function stopQqPolling(): void {
  if (qqPollTimer) window.clearInterval(qqPollTimer);
  qqPollTimer = undefined;
  isCheckingQq = false;
  qqFailCount = 0;
}

async function startQr(): Promise<void> {
  stopPolling();
  const sessionId = ++neteaseSessionId;
  qrLoading.value = true;
  auth.error = '';
  qrMessage.value = '';
  try {
    const session = await api.createNeteaseQr();
    if (!isMounted || sessionId !== neteaseSessionId) return;
    qr.value = session;
    qrState.value = 'waiting';

    pollTimer = window.setInterval(async () => {
      if (!qr.value || isCheckingNetease || !isMounted || sessionId !== neteaseSessionId) return;
      isCheckingNetease = true;
      try {
        const check = await api.checkNeteaseQr(qr.value.key);
        if (!isMounted || sessionId !== neteaseSessionId) return;
        neteaseFailCount = 0;
        qrState.value = check.state;
        qrMessage.value = check.message;
        if (check.state === 'confirmed') {
          stopPolling();
          qr.value = null;
          await auth.refresh();
          emit('notify', '网易云登录成功，凭证已安全保存在本地网关');
        } else if (check.state === 'expired' || check.state === 'failed') {
          stopPolling();
          if (check.state === 'failed') {
            qrMessage.value = check.message || '扫码已取消或登录失败';
          }
        }
      } catch (e) {
        neteaseFailCount += 1;
        // 允许连续偶发失败 3 次，避免手机确认跳转瞬间的网络微抖动导致轮询直接中断
        if (neteaseFailCount >= 4) {
          stopPolling();
          qrMessage.value = e instanceof ApiError ? e.message : '轮询状态失败';
        }
      } finally {
        isCheckingNetease = false;
      }
    }, 2000);
  } catch (e) {
    if (!isMounted || sessionId !== neteaseSessionId) return;
    const msg = e instanceof ApiError ? e.message : '获取登录二维码失败';
    auth.error = msg;
    qrMessage.value = msg;
    emit('notify', msg);
  } finally {
    if (isMounted && sessionId === neteaseSessionId) {
      qrLoading.value = false;
    }
  }
}

async function startQqQr(channel?: 'qq' | 'wx'): Promise<void> {
  const type = channel === 'wx' || channel === 'qq' ? channel : (qqQrType.value === 'wx' ? 'wx' : 'qq');
  if (channel && channel !== qqQrType.value) {
    qqQr.value = null; // 切换渠道立即清空旧二维码
  }
  qqQrType.value = type;
  stopQqPolling();
  const sessionId = ++qqSessionId;
  qqQrLoading.value = true;
  auth.error = '';
  qqQrMessage.value = '';
  try {
    const session = await api.createQqQr(type);
    if (!isMounted || sessionId !== qqSessionId) return;
    qqQr.value = session;
    qqQrState.value = 'waiting';

    qqPollTimer = window.setInterval(async () => {
      if (!qqQr.value || isCheckingQq || !isMounted || sessionId !== qqSessionId) return;
      isCheckingQq = true;
      try {
        const check = await api.checkQqQr(qqQr.value.key, type);
        if (!isMounted || sessionId !== qqSessionId) return;
        qqFailCount = 0;
        qqQrState.value = check.state;
        qqQrMessage.value = check.message;
        if (check.state === 'confirmed') {
          stopQqPolling();
          qqQr.value = null;
          await auth.refresh();
          emit('notify', 'QQ 音乐登录成功，凭证已安全保存在本地网关');
        } else if (check.state === 'expired' || check.state === 'failed') {
          stopQqPolling();
          if (check.state === 'failed') {
            qqQrMessage.value = check.message || '扫码已取消或登录失败';
          }
        }
      } catch (e) {
        qqFailCount += 1;
        if (qqFailCount >= 4) {
          stopQqPolling();
          qqQrMessage.value = e instanceof ApiError ? e.message : '轮询 QQ 扫码状态失败';
        }
      } finally {
        isCheckingQq = false;
      }
    }, 2000);
  } catch (e) {
    if (!isMounted || sessionId !== qqSessionId) return;
    const msg = e instanceof ApiError ? e.message : '获取 QQ 登录二维码失败';
    auth.error = msg;
    qqQrMessage.value = msg;
    emit('notify', msg);
  } finally {
    if (isMounted && sessionId === qqSessionId) {
      qqQrLoading.value = false;
    }
  }
}

async function saveQq(): Promise<void> {
  const ok = await auth.submitQqCookie();
  emit('notify', ok ? 'QQ 音乐 Cookie 已提交网关（页面不留存明文）' : 'QQ 音乐 Cookie 保存失败');
}

function confirmLogoutNetease(): void {
  if (!confirm('确定要退出网易云账号并清除本地凭据吗？')) return;
  void auth.logoutNetease();
}

function confirmLogoutQq(): void {
  if (!confirm('确定要退出 QQ 音乐账号并清除本地凭据吗？')) return;
  void auth.logoutQq();
}

function resetSettings(): void {
  settings.reset();
  emit('notify', '已恢复默认播放偏好');
}

function clearLocalData(): void {
  if (!confirm('确定要清空本地播放队列与收藏数据吗？')) return;
  player.clearQueue();
  favorites.clear();
  emit('notify', '已清空本地队列与收藏');
}

onMounted(() => {
  isMounted = true;
  void auth.refresh();
});

onBeforeUnmount(() => {
  isMounted = false;
  stopPolling();
  stopQqPolling();
});
</script>

<template>
  <div class="page-header">
    <h1 class="page-title">偏好与设置</h1>
  </div>

  <div v-if="auth.error" class="notice error">
    <Icon name="close" size="16" />
    <span>{{ auth.error }}</span>
  </div>
  <div v-if="auth.notice" class="notice ok">
    <Icon name="check" size="16" />
    <span>{{ auth.notice }}</span>
  </div>

  <!-- 播放偏好设置 -->
  <section class="card settings-section">
    <div class="section-card-header">
      <div class="section-card-title">
        <Icon name="settings" size="18" style="color: var(--accent)" />
        <h2>播放偏好</h2>
      </div>
      <button class="ghost" style="font-size: 12px" @click="resetSettings">恢复默认</button>
    </div>

    <div class="row wrap" style="gap: 16px; margin-top: 14px">
      <label class="setting-field" style="flex: 2; min-width: 220px">
        <span class="field-label">默认音质偏好</span>
        <select v-model="settings.quality">
          <option v-for="opt in QUALITY_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}（{{ opt.hint }}）
          </option>
        </select>
      </label>

      <label class="setting-field" style="flex: 1; min-width: 160px">
        <span class="field-label">默认搜索平台</span>
        <select v-model="settings.platform">
          <option value="all">双平台聚合</option>
          <option value="netease">仅网易云音乐</option>
          <option value="qq">仅 QQ 音乐</option>
        </select>
      </label>

      <label class="setting-field" style="width: 140px">
        <span class="field-label">界面主题</span>
        <select v-model="settings.theme">
          <option value="light">浅色模式 (亮)</option>
          <option value="dark">深色模式 (暗)</option>
        </select>
      </label>

      <label class="setting-field" style="width: 110px">
        <span class="field-label">每页曲目数</span>
        <input v-model.number="settings.limit" type="number" min="5" max="50" />
      </label>
    </div>

    <div class="setting-toggle-row">
      <label class="row" style="cursor: pointer; gap: 8px">
        <input type="checkbox" v-model="settings.showTranslation" style="width: auto" />
        <span>歌词浮层中显示歌词双语翻译</span>
      </label>
    </div>

    <div class="field-tip">
      无损 (FLAC) 与 Hi-Res 需对应平台已配置有效会员；匿名状态下网关将自动回退至最高可用档位。
    </div>
  </section>

  <!-- 平台后端连通性与凭证状态 -->
  <section class="card settings-section">
    <div class="section-card-header">
      <div class="section-card-title">
        <Icon name="sparkles" size="18" style="color: var(--accent)" />
        <h2>平台服务状态</h2>
      </div>
      <button class="ghost" :disabled="auth.loading" style="font-size: 12px" @click="auth.refresh()">
        <Icon name="refresh" size="13" :class="{ 'spin-icon': auth.loading }" />
        <span>{{ auth.loading ? '正在检测…' : '检测连通性' }}</span>
      </button>
    </div>

    <div class="status-grid">
      <div
        v-for="status in auth.statuses"
        :key="status.platform"
        class="platform-status-card"
      >
        <div class="row" style="justify-content: space-between; margin-bottom: 8px">
          <PlatformBadge :platform="status.platform" />
          <span
            class="health-badge"
            :class="auth.healthOf(status.platform)?.reachable ? 'online' : 'offline'"
          >
            {{ auth.healthOf(status.platform)?.reachable ? `${auth.healthOf(status.platform)?.latencyMs}ms` : '未连接' }}
          </span>
        </div>

        <div class="platform-auth-desc">
          <span class="muted small">身份：</span>
          <span style="font-weight: 600">
            {{ status.state === 'configured' ? (status.hasMemberKey ? '会员凭证有效' : '已配置常规凭证') : '匿名身份（限制高品质）' }}
          </span>
        </div>

        <div v-if="status.fingerprint" class="fingerprint-tag">
          指纹：{{ status.fingerprint }}
        </div>
      </div>
    </div>
  </section>

  <!-- 网易云扫码登录 -->
  <section class="card settings-section">
    <div class="section-card-header">
      <div class="section-card-title">
        <PlatformBadge platform="netease" />
        <h2>网易云音乐扫码登录</h2>
      </div>
      <button
        v-if="neteaseStatus.state === 'configured'"
        class="ghost"
        style="color: var(--accent); font-size: 12px"
        @click="confirmLogoutNetease()"
      >
        退出网易云账号
      </button>
    </div>

    <p class="small muted" style="margin: 0 0 14px">
      使用网易云音乐手机 App 扫码登录。登录凭证由网关在服务端直接持久化保存。
    </p>

    <div v-if="qr" class="qr-login-box">
      <div class="qr-image-wrapper">
        <img :src="qr.qrimg" alt="登录二维码" class="qr-image" />
      </div>
      <div class="qr-status-info">
        <div class="qr-state-pill" :class="{ warn: qrState === 'expired', success: qrState === 'confirmed' }">
          {{ qrStateText }}
        </div>
        <div v-if="qrMessage" class="small muted" style="margin-top: 6px">{{ qrMessage }}</div>
      </div>
    </div>

    <div v-else-if="qrMessage" class="field-error-tip">
      <Icon name="close" size="14" />
      <span>{{ qrMessage }}</span>
    </div>

    <div class="row" style="margin-top: 14px">
      <button class="primary" :disabled="qrLoading" @click="startQr">
        <Icon name="refresh" size="14" />
        <span>{{ qrLoading ? '正在生成…' : qr ? '重新生成二维码' : '获取登录二维码' }}</span>
      </button>
    </div>
  </section>

  <!-- QQ 音乐扫码登录与凭证管理 -->
  <section class="card settings-section">
    <div class="section-card-header">
      <div class="section-card-title">
        <PlatformBadge platform="qq" />
        <h2>QQ 音乐扫码登录</h2>
      </div>
      <button
        v-if="qqStatus.state === 'configured'"
        class="ghost"
        style="color: var(--accent); font-size: 12px"
        @click="confirmLogoutQq()"
      >
        退出 QQ 音乐账号
      </button>
    </div>

    <p class="small muted" style="margin: 0 0 14px">
      支持使用手机 QQ 或微信 App 扫码登录。登录凭证由本地网关在服务端直接持久化保存。
    </p>

    <!-- 登录通道切换 -->
    <div class="channel-switch-row">
      <span class="small muted">扫码客户端：</span>
      <div class="channel-tabs">
        <button
          type="button"
          class="channel-tab-btn"
          :class="{ active: qqQrType === 'qq' }"
          @click="startQqQr('qq')"
        >
          手机 QQ 扫码
        </button>
        <button
          type="button"
          class="channel-tab-btn"
          :class="{ active: qqQrType === 'wx' }"
          @click="startQqQr('wx')"
        >
          微信扫码
        </button>
      </div>
    </div>

    <div v-if="qqQr" class="qr-login-box">
      <div class="qr-image-wrapper">
        <img :src="qqQr.qrimg" :alt="qqQrType === 'wx' ? '微信登录二维码' : 'QQ 登录二维码'" class="qr-image" />
      </div>
      <div class="qr-status-info">
        <div class="qr-state-pill" :class="{ warn: qqQrState === 'expired', success: qqQrState === 'confirmed' }">
          {{ qqQrStateText }}
        </div>
        <div v-if="qqQrMessage" class="small muted" style="margin-top: 6px">{{ qqQrMessage }}</div>
      </div>
    </div>

    <div v-else-if="qqQrMessage" class="field-error-tip">
      <Icon name="close" size="14" />
      <span>{{ qqQrMessage }}</span>
    </div>

    <div class="row" style="margin-top: 14px; gap: 12px">
      <button class="primary" :disabled="qqQrLoading" @click="startQqQr()">
        <Icon name="refresh" size="14" />
        <span>{{ qqQrLoading ? '正在生成…' : qqQr ? '重新生成二维码' : '获取登录二维码' }}</span>
      </button>

      <button
        class="ghost"
        style="font-size: 12px"
        @click="showManualQqCookie = !showManualQqCookie"
      >
        {{ showManualQqCookie ? '收起手动配置' : '手动填入 Cookie (备用)' }}
      </button>
    </div>

    <!-- 手动 Cookie 配置折叠区 -->
    <div v-if="showManualQqCookie" class="manual-cookie-pane">
      <div class="small muted" style="margin-bottom: 8px">
        在浏览器开发者工具中复制 <code>y.qq.com</code> 的 Cookie（需包含 <code>qm_keyst</code> 及 <code>uin</code>）。
        点击保存后将直接发送至本地网关，页面内存即时销毁明文。
      </div>
      <textarea
        v-model="auth.qqCookieDraft"
        rows="3"
        class="cookie-textarea"
        placeholder="uin=o...; qm_keyst=...; qqmusic_key=...;"
      />
      <div class="row" style="margin-top: 10px; gap: 10px">
        <button class="primary" :disabled="auth.qqSubmitting || !auth.qqCookieDraft.trim()" @click="saveQq">
          {{ auth.qqSubmitting ? '保存中…' : '提交至本地网关' }}
        </button>
        <button
          v-if="qqStatus.state === 'configured'"
          class="ghost"
          style="font-size: 12px"
          @click="auth.clearQqCookie()"
        >
          清除现有 Cookie
        </button>
      </div>
    </div>
  </section>

  <!-- 本地数据存储管理 -->
  <section class="card settings-section">
    <div class="section-card-header">
      <div class="section-card-title">
        <Icon name="music" size="18" style="color: var(--text-secondary)" />
        <h2>本地存储</h2>
      </div>
    </div>
    <p class="small muted" style="margin: 0 0 14px">
      播放历史队列、歌曲收藏和个性化配置均存于当前浏览器 LocalStorage，不会向外界传输任何个人播放记录。
    </p>
    <button class="ghost clear-danger-btn" @click="clearLocalData">
      清空本地播放队列与收藏
    </button>
  </section>
</template>

<style scoped>
.settings-section {
  margin-bottom: 22px;
}

.section-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.section-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-card-title h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
}

.setting-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.setting-toggle-row {
  margin-top: 16px;
  font-size: 13.5px;
}

.field-tip {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 14px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.platform-status-card {
  padding: 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
  border: 1px solid var(--border-default);
}

.health-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--radius-full);
}

.health-badge.online {
  color: var(--success);
  background: var(--success-soft);
}

.health-badge.offline {
  color: var(--danger);
  background: var(--danger-soft);
}

.platform-auth-desc {
  font-size: 13px;
  margin-top: 6px;
}

.fingerprint-tag {
  font-size: 11px;
  font-family: monospace;
  color: var(--text-tertiary);
  margin-top: 6px;
}

.qr-login-box {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px;
  background: var(--bg-canvas);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  margin-top: 12px;
}

.qr-image-wrapper {
  background: #fff;
  padding: 8px;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
}

.qr-image {
  width: 150px;
  height: 150px;
  display: block;
}

.qr-state-pill {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.qr-state-pill.warn {
  color: var(--warn);
}

.qr-state-pill.success {
  color: var(--success);
}

.channel-switch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.channel-tabs {
  display: inline-flex;
  background: var(--bg-canvas);
  border-radius: var(--radius-sm);
  padding: 2px;
  border: 1px solid var(--border-default);
}

.channel-tab-btn {
  padding: 4px 12px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: calc(var(--radius-sm) - 2px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.channel-tab-btn.active {
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}

.manual-cookie-pane {
  margin-top: 14px;
  padding: 14px;
  background: var(--bg-canvas);
  border-radius: var(--radius-sm);
  border: 1px dashed var(--border-default);
}

.cookie-textarea {
  background: var(--bg-canvas);
  font-family: monospace;
  font-size: 12px;
  line-height: 1.4;
  resize: vertical;
}

.clear-danger-btn {
  border: 1px solid var(--netease-border);
  color: var(--danger);
}

.clear-danger-btn:hover {
  background: var(--danger-soft);
}

.field-error-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--danger);
  font-size: 13px;
  margin-top: 10px;
  padding: 8px 12px;
  background: var(--danger-soft);
  border: 1px solid var(--netease-border);
  border-radius: var(--radius-sm);
}
</style>
