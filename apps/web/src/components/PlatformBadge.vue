<script setup lang="ts">
import type { Platform } from '@/api/types';
import { PLATFORM_LABELS } from '@/format';

defineProps<{ platform: Platform; compact?: boolean }>();
</script>

<template>
  <span class="badge" :class="platform">{{ compact ? (platform === 'netease' ? '云' : 'Q') : PLATFORM_LABELS[platform] }}</span>
</template>
