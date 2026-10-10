import type { Track } from '@/api/types';

const DB_NAME = 'webmuic_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'cached_tracks';

export interface CachedTrackRecord {
  id: string; // platform:id
  track: Track;
  blob: Blob;
  size: number;
  quality: string;
  cachedAt: number;
  /** 'local' = 用户导入的本地文件；缺省为在线曲目的离线缓存 */
  source?: 'cache' | 'local';
  /** 本地导入时同名 .lrc 的内容 */
  lyric?: string;
  fileName?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export const offlineStorage = {
  async saveTrack(
    track: Track,
    blob: Blob,
    quality = 'high',
    extra: Pick<CachedTrackRecord, 'source' | 'lyric' | 'fileName'> = {},
  ): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: CachedTrackRecord = {
        id: track.id,
        track,
        blob,
        size: blob.size,
        quality,
        cachedAt: Date.now(),
        ...extra,
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getTrackBlob(trackId: string): Promise<Blob | null> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(trackId);
      req.onsuccess = () => {
        const record = req.result as CachedTrackRecord | undefined;
        resolve(record ? record.blob : null);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getRecord(trackId: string): Promise<CachedTrackRecord | null> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(trackId);
      req.onsuccess = () => resolve((req.result as CachedTrackRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  },

  async hasTrack(trackId: string): Promise<boolean> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count(trackId);
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = () => reject(req.error);
    });
  },

  async removeTrack(trackId: string): Promise<void> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(trackId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getAllCachedTracks(): Promise<CachedTrackRecord[]> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as CachedTrackRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getCachedCount(): Promise<number> {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
};
