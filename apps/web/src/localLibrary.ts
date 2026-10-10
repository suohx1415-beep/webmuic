import type { Track } from '@/api/types';
import { offlineStorage } from '@/offlineStorage';

/**
 * 本地音乐导入：把用户选的音频文件连同元数据一起存进 IndexedDB（与离线缓存同库），
 * 之后 useAudio 会像播放离线缓存一样直接从本地 Blob 播放，不经过网关。
 */

export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm'];
const LYRIC_EXTENSION = 'lrc';

interface ParsedTags {
  title?: string;
  artist?: string;
  album?: string;
  cover?: Blob;
}

export interface ImportResult {
  added: Track[];
  skipped: { name: string; reason: string }[];
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const file = name.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return dot === -1 ? file : file.slice(0, dot);
}

/** 稳定 ID：同一个文件重复导入会覆盖而不是新增 */
function localIdOf(file: File): string {
  const key = `${file.name}|${file.size}|${file.lastModified}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `local:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** 文件名兜底：支持「歌手 - 歌名」 */
function guessFromFileName(name: string): { title: string; artist?: string } {
  const base = baseName(name).replace(/_/g, ' ').trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0]!.trim(), title: parts.slice(1).join(' - ').trim() };
  return { title: base };
}

// ---------- 标签解析（ID3v2 / FLAC），解析失败一律回退到文件名 ----------

function decodeText(bytes: Uint8Array, encoding: number): string {
  let label = 'latin1';
  if (encoding === 1) label = 'utf-16';
  else if (encoding === 2) label = 'utf-16be';
  else if (encoding === 3) label = 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes).replace(/\0+$/g, '').split('\0')[0]!.trim();
  } catch {
    return '';
  }
}

function synchsafe(b: Uint8Array, at: number): number {
  return ((b[at]! & 0x7f) << 21) | ((b[at + 1]! & 0x7f) << 14) | ((b[at + 2]! & 0x7f) << 7) | (b[at + 3]! & 0x7f);
}

/** 找到某编码下文本终止符（UTF-16 是双零字节）之后的位置 */
function skipTerminated(b: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  for (let i = from; i < b.length; i += wide ? 2 : 1) {
    if (b[i] === 0 && (!wide || b[i + 1] === 0)) return i + (wide ? 2 : 1);
  }
  return b.length;
}

async function parseId3(file: File): Promise<ParsedTags | null> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const version = head[3]!;
  if (version < 3 || version > 4) return null;
  const size = synchsafe(head, 6);
  const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const tags: ParsedTags = {};
  let pos = 0;
  while (pos + 10 <= b.length) {
    const id = String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize = version === 4
      ? synchsafe(b, pos + 4)
      : ((b[pos + 4]! << 24) | (b[pos + 5]! << 16) | (b[pos + 6]! << 8) | b[pos + 7]!) >>> 0;
    const start = pos + 10;
    const end = start + frameSize;
    if (frameSize <= 0 || end > b.length) break;
    const frame = b.subarray(start, end);
    if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') {
      const text = decodeText(frame.subarray(1), frame[0]!);
      if (id === 'TIT2') tags.title = text;
      if (id === 'TPE1') tags.artist = text.replace(/\//g, ' / ');
      if (id === 'TALB') tags.album = text;
    } else if (id === 'APIC' && !tags.cover) {
      const encoding = frame[0]!;
      const mimeEnd = skipTerminated(frame, 1, 0);
      const mime = decodeText(frame.subarray(1, mimeEnd), 0) || 'image/jpeg';
      const dataStart = skipTerminated(frame, mimeEnd + 1, encoding);
      tags.cover = new Blob([frame.slice(dataStart)], { type: mime.includes('/') ? mime : `image/${mime}` });
    }
    pos = end;
  }
  return tags;
}

async function parseFlac(file: File): Promise<ParsedTags | null> {
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...magic) !== 'fLaC') return null;
  const tags: ParsedTags = {};
  let pos = 4;
  for (let guard = 0; guard < 64; guard++) {
    const header = new Uint8Array(await file.slice(pos, pos + 4).arrayBuffer());
    if (header.length < 4) break;
    const last = (header[0]! & 0x80) !== 0;
    const type = header[0]! & 0x7f;
    const len = (header[1]! << 16) | (header[2]! << 8) | header[3]!;
    const bodyStart = pos + 4;
    if (type === 4 || (type === 6 && !tags.cover)) {
      const body = new Uint8Array(await file.slice(bodyStart, bodyStart + len).arrayBuffer());
      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      if (type === 4) {
        let p = 0;
        const vendorLen = view.getUint32(p, true);
        p += 4 + vendorLen;
        const count = view.getUint32(p, true);
        p += 4;
        const utf8 = new TextDecoder('utf-8');
        for (let i = 0; i < count && p + 4 <= body.length; i++) {
          const l = view.getUint32(p, true);
          p += 4;
          const entry = utf8.decode(body.subarray(p, p + l));
          p += l;
          const eq = entry.indexOf('=');
          if (eq === -1) continue;
          const key = entry.slice(0, eq).toUpperCase();
          const value = entry.slice(eq + 1).trim();
          if (key === 'TITLE' && !tags.title) tags.title = value;
          else if (key === 'ARTIST') tags.artist = tags.artist ? `${tags.artist} / ${value}` : value;
          else if (key === 'ALBUM' && !tags.album) tags.album = value;
        }
      } else {
        let p = 4;
        const mimeLen = view.getUint32(p);
        p += 4;
        const mime = new TextDecoder('latin1').decode(body.subarray(p, p + mimeLen));
        p += mimeLen;
        const descLen = view.getUint32(p);
        p += 4 + descLen + 16;
        const dataLen = view.getUint32(p);
        p += 4;
        tags.cover = new Blob([body.slice(p, p + dataLen)], { type: mime || 'image/jpeg' });
      }
    }
    pos = bodyStart + len;
    if (last) break;
  }
  return tags;
}

/** 把封面缩成 200px 的 JPEG data URL：小到可以随队列/历史一起存进 localStorage */
async function coverToDataUrl(blob: Blob): Promise<string | undefined> {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return undefined;
  try {
    const bitmap = await createImageBitmap(blob);
    const size = 200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return undefined;
  }
}

/** 读时长：浏览器解不了的格式会超时返回 0 */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(0), 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(-1);
    audio.src = url;
  });
}

async function readTags(file: File): Promise<ParsedTags> {
  try {
    const ext = extOf(file.name);
    if (ext === 'mp3') return (await parseId3(file)) ?? {};
    if (ext === 'flac') return (await parseFlac(file)) ?? {};
  } catch {
    // 标签损坏时回退到文件名
  }
  return {};
}

export function isAudioFile(file: File): boolean {
  return AUDIO_EXTENSIONS.includes(extOf(file.name)) || file.type.startsWith('audio/');
}

/** 导入一批文件；同名 .lrc 会作为该曲歌词一起保存 */
export async function importLocalFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const lyrics = new Map<string, File>();
  for (const f of files) {
    if (extOf(f.name) === LYRIC_EXTENSION) lyrics.set(baseName(f.webkitRelativePath || f.name).toLowerCase(), f);
  }
  const audioFiles = files.filter(isAudioFile);
  const result: ImportResult = { added: [], skipped: [] };

  for (const [i, file] of audioFiles.entries()) {
    onProgress?.(i, audioFiles.length);
    const duration = await readDuration(file);
    if (duration < 0) {
      result.skipped.push({ name: file.name, reason: '浏览器无法解码这种格式' });
      continue;
    }
    const tags = await readTags(file);
    const guess = guessFromFileName(file.name);
    const coverUrl = tags.cover ? await coverToDataUrl(tags.cover) : undefined;
    const id = localIdOf(file);
    const track: Track = {
      id,
      platform: 'local',
      platformTrackId: id.slice('local:'.length),
      title: tags.title || guess.title,
      artists: (tags.artist || guess.artist || '未知歌手').split(/\s*\/\s*/).map((name) => ({ name })),
      album: { name: tags.album || '本地音乐', coverUrl },
      durationMs: Math.round(duration * 1000),
      qualities: [],
    };
    const lrcFile = lyrics.get(baseName(file.webkitRelativePath || file.name).toLowerCase());
    const lyric = lrcFile ? await lrcFile.text() : undefined;
    await offlineStorage.saveTrack(track, file, 'local', { source: 'local', lyric, fileName: file.name });
    result.added.push(track);
  }
  onProgress?.(audioFiles.length, audioFiles.length);
  return result;
}

export async function listLocalTracks(): Promise<Track[]> {
  const all = await offlineStorage.getAllCachedTracks();
  return all
    .filter((r) => r.source === 'local' || r.track.platform === 'local')
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .map((r) => r.track);
}
