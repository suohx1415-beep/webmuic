<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Track } from '@/api/types';
import Icon from '@/components/Icon.vue';
import TrackList from '@/components/TrackList.vue';
import { artistNames, formatBytes } from '@/format';
import { AUDIO_EXTENSIONS, importLocalFiles, listLocalTracks } from '@/localLibrary';
import { offlineStorage } from '@/offlineStorage';
import { usePlayerStore } from '@/stores/player';

const emit = defineEmits<{ notify: [message: string] }>();
const player = usePlayerStore();

const tracks = ref<Track[]>([]);
const loading = ref(true);
const importing = ref(false);
const progress = ref({ done: 0, total: 0 });
const dragging = ref(false);
const filter = ref('');
const usage = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);

const accept = [...AUDIO_EXTENSIONS.map((e) => `.${e}`), '.lrc', 'audio/*'].join(',');

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return tracks.value;
  return tracks.value.filter((t) =>
    `${t.title} ${artistNames(t)} ${t.album.name}`.toLowerCase().includes(q),
  );
});

const totalDuration = computed(() => {
  const minutes = Math.round(tracks.value.reduce((sum, t) => sum + t.durationMs, 0) / 60000);
  if (minutes < 1) return '不到 1 分钟';
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
});

async function refresh(): Promise<void> {
  try {
    tracks.value = await listLocalTracks();
  } catch {
    emit('notify', '读取本地曲库失败：浏览器可能禁用了 IndexedDB');
  } finally {
    loading.value = false;
  }
  if (navigator.storage?.estimate) {
    const { usage: used, quota } = await navigator.storage.estimate();
    usage.value = used ? `已用 ${formatBytes(used)}${quota ? ` / 可用约 ${formatBytes(quota)}` : ''}` : '';
  }
}

async function runImport(files: File[]): Promise<void> {
  if (!files.length || importing.value) return;
  importing.value = true;
  progress.value = { done: 0, total: files.length };
  // 申请持久化存储，避免浏览器空间紧张时自动清掉导入的歌
  void navigator.storage?.persist?.();
  try {
    const result = await importLocalFiles(files, (done, total) => {
      progress.value = { done, total };
    });
    await refresh();
    const skipped = result.skipped.length ? `，${result.skipped.length} 个无法识别已跳过` : '';
    emit('notify', result.added.length ? `已导入 ${result.added.length} 首本地歌曲${skipped}` : `没有可导入的音频文件${skipped}`);
  } catch (e) {
    emit('notify', `导入失败：${e instanceof Error ? e.message : '未知错误'}（可能是浏览器存储空间不足）`);
  } finally {
    importing.value = false;
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  void runImport([...(input.files ?? [])]);
  input.value = '';
}

/** 拖进来的可能是文件夹：递归展开 */
async function collectEntries(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];
  const readEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await readEntry(child);
      } while (batch.length > 0);
    }
  };
  const entries = [...items].map((item) => item.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  for (const entry of entries) await readEntry(entry);
  return files;
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false;
  const dt = event.dataTransfer;
  if (!dt) return;
  const files = dt.items?.length ? await collectEntries(dt.items) : [...dt.files];
  void runImport(files);
}

function playAll(shuffle = false): void {
  const list = filtered.value;
  if (!list.length) return;
  if (shuffle) player.mode = 'shuffle';
  const first = shuffle ? list[Math.floor(Math.random() * list.length)]! : list[0]!;
  player.playTrackList(list, first);
}

async function removeTrack(track: Track): Promise<void> {
  if (!window.confirm(`从本地曲库删除《${track.title}》？（只删除浏览器里的副本，不会动你电脑上的原文件）`)) return;
  await offlineStorage.removeTrack(track.id);
  const at = player.queue.findIndex((t) => t.id === track.id);
  if (at !== -1) player.removeAt(at);
  await refresh();
  emit('notify', `已删除《${track.title}》`);
}

onMounted(refresh);
</script>

<template>
  <div class="page-header local-header">
    <div>
      <h1 class="page-title">本地音乐</h1>
      <p class="local-sub">
        <template v-if="tracks.length">{{ tracks.length }} 首 · {{ totalDuration }}</template>
        <template v-else>把电脑里的歌导进来，和两个平台的歌混在一起听</template>
        <template v-if="usage"> · {{ usage }}</template>
      </p>
    </div>
    <div class="local-import-btns">
      <button :disabled="importing" @click="fileInput?.click()"><Icon name="plus" size="15" />选择文件</button>
      <button :disabled="importing" @click="folderInput?.click()"><Icon name="folder" size="15" />导入文件夹</button>
    </div>
    <input ref="fileInput" type="file" multiple :accept="accept" hidden @change="onPick">
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick">
  </div>

  <div
    class="drop-zone"
    :class="{ dragging, compact: tracks.length > 0, busy: importing }"
    @dragover.prevent="dragging = true"
    @dragleave.self="dragging = false"
    @drop.prevent="onDrop"
  >
    <template v-if="importing">
      <div class="import-progress"><span :style="{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }" /></div>
      <span>正在导入 {{ progress.done }} / {{ progress.total }}…</span>
    </template>
    <template v-else>
      <Icon name="folder" :size="tracks.length ? 18 : 30" />
      <span>{{ dragging ? '松开即可导入' : '把音乐文件或整个文件夹拖到这里' }}</span>
      <small v-if="!tracks.length">支持 {{ AUDIO_EXTENSIONS.join(' / ') }}；同名 .lrc 会自动作为歌词。文件会复制一份存进浏览器，断网也能听。</small>
    </template>
  </div>

  <template v-if="tracks.length">
    <div class="local-toolbar">
      <button class="primary" @click="playAll()"><Icon name="play" size="15" />全部播放</button>
      <button @click="playAll(true)"><Icon name="shuffle" size="15" />随机播放</button>
      <label class="local-filter">
        <Icon name="search" size="15" />
        <input v-model="filter" placeholder="在本地曲库中筛选" aria-label="筛选本地歌曲">
      </label>
    </div>
    <TrackList
      :tracks="filtered"
      removable
      empty-text="没有匹配的本地歌曲"
      @remove="removeTrack"
      @error="emit('notify', $event)"
    />
  </template>
  <div v-else-if="loading" class="local-loading">正在读取本地曲库…</div>
</template>

<style scoped>
.local-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.local-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); }
.local-import-btns { display: flex; gap: 8px; }
.local-import-btns button { padding: 8px 14px; font-size: 12.5px; }
.drop-zone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 190px; margin-bottom: 22px; padding: 24px; border: 1.5px dashed var(--border-default); border-radius: var(--radius-lg); background: var(--bg-surface); color: var(--text-secondary); text-align: center; transition: border-color 150ms ease, background-color 150ms ease; }
.drop-zone small { max-width: 520px; font-size: 12px; color: var(--text-tertiary); line-height: 1.7; }
.drop-zone.compact { flex-direction: row; min-height: 0; padding: 14px 18px; font-size: 13px; }
.drop-zone.dragging { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.drop-zone.busy { flex-direction: column; }
.import-progress { width: min(360px, 100%); height: 4px; border-radius: 999px; background: var(--border-default); overflow: hidden; }
.import-progress span { display: block; height: 100%; background: var(--accent); transition: width 200ms ease; }
.local-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.local-toolbar > button { padding: 8px 16px; }
.local-filter { margin-left: auto; display: flex; align-items: center; gap: 8px; padding: 0 14px; border: 1px solid var(--border-default); border-radius: 999px; background: var(--bg-surface); color: var(--text-tertiary); }
.local-filter input { border: 0; background: transparent; padding: 8px 0; font-size: 12.5px; width: 180px; box-shadow: none; }
.local-filter input:focus-visible { outline: none; }
.local-filter:focus-within { border-color: var(--accent-border); }
.local-loading { padding: 40px 0; text-align: center; color: var(--text-tertiary); }
@media (max-width: 600px) { .local-filter { margin-left: 0; width: 100%; } .local-filter input { width: 100%; } }
@media (prefers-reduced-motion: reduce) { .drop-zone, .import-progress span { transition: none; } }
</style>
