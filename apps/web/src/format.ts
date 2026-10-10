import type { Platform, QualityLevel, Track } from '@/api/types';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
};

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  standard: '标准',
  high: '高品质',
  lossless: '无损',
  hires: 'Hi-Res',
};

export function artistNames(track: Track): string {
  const names = track.artists.map((a) => a.name).filter(Boolean);
  return names.length ? names.join(' / ') : '未知歌手';
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function qualityHint(track: Track): string {
  const best = track.qualities[track.qualities.length - 1];
  return best ? QUALITY_LABELS[best.level] : '';
}

/** 网易云封面默认是原图（可达近 1MB），按显示尺寸请求缩略图；其他来源原样返回。 */
export function thumb(url: string | undefined, px: number): string {
  if (!url) return '';
  if (!/(^|\.)music\.126\.net\//.test(url.replace(/^https?:\/\//, ''))) return url;
  const base = url.replace(/[?#].*$/, '');
  return `${base}?param=${px}y${px}`;
}
