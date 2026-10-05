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
  color: #ff657d;
  background: rgba(230, 0, 38, 0.1);
  border: 1px solid rgba(230, 0, 38, 0.25);
}

.platform-badge.netease .platform-dot {
  background: #ff4b60;
  box-shadow: 0 0 6px rgba(255, 75, 96, 0.6);
}

.platform-badge.qq {
  color: #34d399;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.25);
}

.platform-badge.qq .platform-dot {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
}

:global([data-theme='light']) .platform-badge.netease {
  color: #be123c;
  background: rgba(225, 29, 72, 0.08);
  border-color: rgba(225, 29, 72, 0.22);
}

:global([data-theme='light']) .platform-badge.qq {
  color: #047857;
  background: rgba(5, 150, 105, 0.08);
  border-color: rgba(5, 150, 105, 0.22);
}
</style>
