import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import type { CredentialStatus, HealthPlatform } from '@/api/types';

/**
 * 平台凭证状态与登录动作。
 * 关键约束：QQ cookie 只作为一次 POST 的请求体经过内存，提交后立即清空，
 * 绝不写 localStorage，也不从服务端读回来（服务端只返回状态与指纹）。
 */
export const useAuthStore = defineStore('auth', () => {
  const statuses = ref<CredentialStatus[]>([]);
  const health = ref<HealthPlatform[]>([]);
  const loading = ref(false);
  const error = ref('');
  const notice = ref('');

  // 仅在内存中短暂持有，提交后清空
  const qqCookieDraft = ref('');
  const qqSubmitting = ref(false);

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const body = await api.health();
      health.value = body.platforms;
      statuses.value = body.platforms.map((p) => p.credential);
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '无法获取平台状态';
    } finally {
      loading.value = false;
    }
  }

  const statusOf = computed(
    () => (platform: 'netease' | 'qq') =>
      statuses.value.find((s) => s.platform === platform) ?? {
        platform,
        state: 'anonymous' as const,
        fingerprint: '',
        hasMemberKey: false,
      },
  );

  const healthOf = computed(
    () => (platform: 'netease' | 'qq') =>
      health.value.find((h) => h.platform === platform) ?? null,
  );

  async function submitQqCookie(): Promise<boolean> {
    const cookie = qqCookieDraft.value.trim();
    if (!cookie) {
      error.value = '请先粘贴 cookie';
      return false;
    }
    qqSubmitting.value = true;
    error.value = '';
    notice.value = '';
    try {
      const result = await api.saveQqCookie(cookie);
      notice.value = result.hasUin
        ? 'QQ cookie 已保存到网关（含 uin，会员曲可播）'
        : '已保存，但没解析到 uin，会员曲可能仍不可播';
      await refresh();
      return true;
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '保存失败';
      return false;
    } finally {
      // 无论成功失败都不在界面/内存里留着明文
      qqCookieDraft.value = '';
      qqSubmitting.value = false;
    }
  }

  async function clearQqCookie(): Promise<void> {
    try {
      await api.clearQqCookie();
      notice.value = '已清除 QQ 凭证，回到匿名状态';
      await refresh();
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '清除失败';
    }
  }

  async function logoutNetease(): Promise<void> {
    try {
      await api.logoutNetease();
      notice.value = '已退出网易云登录';
      await refresh();
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '退出失败';
    }
  }

  async function logoutQq(): Promise<void> {
    try {
      await api.logoutQq();
      notice.value = '已退出 QQ 音乐登录，回到匿名状态';
      await refresh();
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : '退出失败';
    }
  }

  return {
    statuses,
    health,
    loading,
    error,
    notice,
    qqCookieDraft,
    qqSubmitting,
    refresh,
    statusOf,
    healthOf,
    submitQqCookie,
    clearQqCookie,
    logoutNetease,
    logoutQq,
  };
});
