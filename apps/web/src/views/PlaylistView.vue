<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '@/api/client';
import type { PlaylistResponse } from '@/api/types';
import PlatformBadge from '@/components/PlatformBadge.vue';
import TrackList from '@/components/TrackList.vue';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();

const data = ref<PlaylistResponse | null>(null);
const loading = ref(false);
const error = ref('');
const manualId = ref('');

async function load(id: string): Promise<void> {
  if (!id) return;
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    data.value = await api.playlist(id);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '歌单加载失败';
  } finally {
    loading.value = false;
  }
}

function playAll(): void {
  if (!data.value || data.value.tracks.length === 0) return;
  player.setQueue(data.value.tracks, 0);
  player.playing = true;
  emit('notify', `已把《${data.value.name}》共 ${data.value.tracks.length} 首加入队列并开始播放`);
}

function enqueueAll(): void {
  if (!data.value) return;
  const added = player.append(data.value.tracks);
  emit('notify', added > 0 ? `已追加 ${added} 首到队列` : '这些曲目已在队列中');
}

function openManual(): void {
  const id = manualId.value.trim();
  if (!id) return;
  router.push(`/playlist/${id}`);
}

watch(
  () => route.params.id,
  (id) => {
    manualId.value = String(id ?? '');
    void load(String(id ?? ''));
  },
);

onMounted(() => {
  manualId.value = String(route.params.id ?? '');
  void load(manualId.value);
});
</script>

<template>
  <h1 class="page-title">歌单</h1>
  <p class="page-sub">
    歌单 id 形如 <code>netease:3778678</code> 或 <code>qq:7614366897</code>。QQ 部分歌单对匿名身份不可见，会给出明确提示。
  </p>

  <form class="row" style="margin-bottom: 16px" @submit.prevent="openManual">
    <input v-model="manualId" placeholder="平台:歌单id" style="max-width: 320px" />
    <button type="submit">打开</button>
  </form>

  <div v-if="loading" class="muted">加载中…</div>
  <div v-else-if="error" class="notice error">{{ error }}</div>

  <template v-if="data">
    <div class="row" style="gap: 16px; margin-bottom: 14px">
      <img
        v-if="data.coverUrl"
        :src="data.coverUrl"
        alt=""
        style="width: 110px; height: 110px; border-radius: 10px; object-fit: cover"
      />
      <div>
        <div class="row">
          <h2 style="margin: 0; font-size: 19px">{{ data.name }}</h2>
          <PlatformBadge :platform="data.platform" />
        </div>
        <div class="small muted" style="margin: 6px 0 10px">{{ data.tracks.length }} 首曲目</div>
        <div class="row">
          <button class="primary" @click="playAll">播放全部</button>
          <button @click="enqueueAll">加入队列</button>
        </div>
      </div>
    </div>
    <TrackList :tracks="data.tracks" @error="emit('notify', $event)" />
  </template>
</template>
