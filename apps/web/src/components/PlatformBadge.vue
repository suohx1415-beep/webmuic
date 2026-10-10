<script setup lang="ts">
import type { Platform } from '@/api/types';
import { PLATFORM_LABELS } from '@/format';

defineProps<{ platform: Platform; compact?: boolean }>();
</script>

<template>
  <span class="platform-badge" :class="platform">
    <span class="platform-dot" />
    <span class="platform-text">{{ compact ? (platform === 'netease' ? '网易' : 'QQ') : PLATFORM_LABELS[platform] }}</span>
  </span>
</template>

<style scoped>
.platform-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  padding: 2px 7px 2px 5px;
  border-radius: 999px;
  letter-spacing: 0.2px;
  white-space: nowrap;
  vertical-align: middle;
  transition: all 0.15s ease;
  user-select: none;
}

.platform-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.platform-badge.netease {
  color: var(--netease);
  background: var(--netease-soft);
  border: 1px solid var(--netease-border);
}

.platform-badge.netease .platform-dot {
  background: var(--netease);
}

.platform-badge.qq {
  color: var(--qq);
  background: var(--qq-soft);
  border: 1px solid var(--qq-border);
}

.platform-badge.qq .platform-dot {
  background: var(--qq);
}
</style>
