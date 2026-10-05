import type { Platform } from './types';

/** offset/limit 是每个平台的分页量，不能与合并后的列表长度比较。 */
export function hasMoreSearchResults(page: {
  offset: number;
  limit: number;
  counts: Partial<Record<Platform, number>>;
  totals: Partial<Record<Platform, number>>;
}, cap: number): boolean {
  const nextOffset = page.offset + page.limit;
  if (nextOffset >= cap) return false;
  return (['netease', 'qq'] as const).some((platform) => {
    const count = page.counts[platform] ?? 0;
    if (count === 0) return false;
    const total = page.totals[platform] ?? 0;
    return total > 0 ? nextOffset < total : count >= page.limit;
  });
}
