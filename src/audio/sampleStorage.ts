/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Persistent audio sample storage with IndexedDB local caching + Cloud Server synchronization.
 * Retains custom audio files and mic recordings across all devices (PC, mobile, tablet).
 */

import { BUILT_IN_SAMPLES } from '../presets/defaultSamples';
import {
  isSampleDeleted,
  markSampleAsDeleted,
  isRhythmDeleted,
} from '../services/deletionRegistry';

const DB_NAME = 'beatbuddy_studio_db';
const DB_VERSION = 1;
const STORE_NAME = 'custom_samples';

export interface StoredSampleRecord {
  id: string;
  name: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

/**
 * Checks if a response from fetch is HTML (e.g. Vercel SPA 404 rewrite returning index.html)
 */
export function isHtmlResponse(resp: Response): boolean {
  const cType = (resp.headers.get('content-type') || '').toLowerCase();
  return cType.includes('text/html');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function saveSampleToStorage(
  id: string,
  name: string,
  blob: Blob
): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredSampleRecord = {
        id,
        name,
        blob,
        mimeType: blob.type || 'audio/wav',
        createdAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Also sync to server immediately for cross-device availability (PC <-> Mobile)
    try {
      await syncSampleToServer(id, name, blob);
    } catch (err) {
      console.warn('Sync of sample to server fallback (offline mode):', err);
    }

    // Also sync to Firebase Firestore database if user is authenticated
    try {
      const { firebaseSyncService } = await import('../services/firebaseSyncService');
      await firebaseSyncService.saveSampleRecord({
        id,
        name,
        blob,
        mimeType: blob.type || 'audio/wav',
        createdAt: Date.now(),
      });
    } catch (err) {
      // Offline or unauthenticated fallback
    }
  } catch (err) {
    console.error('Failed to save sample to IndexedDB:', err);
  }
}

export async function getAllStoredSamples(): Promise<StoredSampleRecord[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const valid: StoredSampleRecord[] = [];
        for (const s of all) {
          if (isSampleDeleted(s.id, s.name)) {
            // Automatically purge deleted sample from IndexedDB
            try { store.delete(s.id); } catch {}
          } else {
            valid.push(s);
          }
        }
        resolve(valid);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to load samples from IndexedDB:', err);
    return [];
  }
}

export async function deleteSampleFromStorage(id: string, name?: string): Promise<void> {
  // Permanently record deletion in Deletion Registry
  markSampleAsDeleted(id, name);

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    // Also delete from server API
    fetch(`/api/samples/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((e) => {
      console.warn('Failed to delete sample on server:', e);
    });
    if (name && name !== id) {
      fetch(`/api/samples/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
    }

    // Also delete from Firebase Firestore
    try {
      const { firebaseSyncService } = await import('../services/firebaseSyncService');
      await firebaseSyncService.deleteSample(id);
    } catch {}
  } catch (err) {
    console.error('Failed to delete sample from IndexedDB:', err);
  }
}

export async function renameSampleInStorage(id: string, newName: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as StoredSampleRecord | undefined;
        if (record) {
          record.name = newName;
          const putReq = store.put(record);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });

    // Also rename on server
    fetch(`/api/samples/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    }).catch((e) => {
      console.warn('Failed to rename sample on server:', e);
    });
  } catch (err) {
    console.error('Failed to rename sample in IndexedDB:', err);
  }
}

// ================= CLOUD SYNC HELPERS ================= //

export async function syncSampleToServer(id: string, name: string, blob: Blob): Promise<boolean> {
  try {
    const base64Data = await blobToBase64(blob);
    const resp = await fetch('/api/samples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        mimeType: blob.type || 'audio/wav',
        base64Data,
      }),
    });
    return resp.ok;
  } catch (err) {
    console.warn('Error syncing sample to server:', err);
    return false;
  }
}

export interface RemoteSampleMeta {
  id: string;
  name: string;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt: number;
}

/**
 * Downloads missing samples from server into local IndexedDB
 */
export async function syncSamplesFromServer(): Promise<number> {
  try {
    let serverSamples: RemoteSampleMeta[] = [];

    // 1. Try server API if available (only if returning JSON and not HTML SPA rewrite)
    try {
      const resp = await fetch('/api/samples');
      if (resp.ok && !isHtmlResponse(resp)) {
        const json = await resp.json();
        if (Array.isArray(json.samples) && json.samples.length > 0) {
          serverSamples = (json.samples as RemoteSampleMeta[]).filter(
            (s) => !isSampleDeleted(s.id, s.name, s.fileName)
          );
        }
      }
    } catch {}

    // 2. Fallback to static public/samples/index.json (Vercel / static host)
    if (serverSamples.length === 0) {
      try {
        const staticResp = await fetch('/samples/index.json');
        if (staticResp.ok && !isHtmlResponse(staticResp)) {
          const list = await staticResp.json();
          const parsed = Array.isArray(list) ? list : (list.samples || []);
          if (parsed.length > 0) {
            serverSamples = (parsed as RemoteSampleMeta[]).filter(
              (s) => !isSampleDeleted(s.id, s.name, s.fileName)
            );
          }
        }
      } catch {}
    }

    // 3. Guarantee built-in catalog samples (ONLY if not deleted by user!)
    const existingIds = new Set(serverSamples.map((s) => s.id));
    for (const b of BUILT_IN_SAMPLES) {
      if (!existingIds.has(b.id) && !isSampleDeleted(b.id, b.name, b.fileName)) {
        serverSamples.push({
          id: b.id,
          name: b.name,
          fileName: b.fileName,
          mimeType: b.mimeType,
          size: b.size,
          createdAt: 1791929936800,
        });
      }
    }

    if (serverSamples.length === 0) return 0;

    const localSamples = await getAllStoredSamples();
    const localIds = new Set(localSamples.map((s) => s.id));
    let downloadedCount = 0;

    for (const remote of serverSamples) {
      if (isSampleDeleted(remote.id, remote.name, remote.fileName)) continue;
      if (!localIds.has(remote.id)) {
        try {
          let audioBlob: Blob | null = null;
          // Priority 1: Direct static asset file (reliable on Vercel and local dev)
          const candidateUrls = [
            remote.fileName ? `/samples/${encodeURIComponent(remote.fileName)}` : null,
            `/samples/${encodeURIComponent(remote.id)}.wav`,
            remote.name ? `/samples/${encodeURIComponent(remote.name)}` : null,
            `/api/samples/${encodeURIComponent(remote.id)}/audio`,
          ].filter(Boolean) as string[];

          for (const url of candidateUrls) {
            try {
              const r = await fetch(url);
              // Crucial for Vercel: make sure it is not the SPA HTML fallback!
              if (r.ok && !isHtmlResponse(r)) {
                audioBlob = await r.blob();
                break;
              }
            } catch {}
          }

          if (audioBlob) {
            const db = await openDatabase();
            await new Promise<void>((res, rej) => {
              const tx = db.transaction(STORE_NAME, 'readwrite');
              const store = tx.objectStore(STORE_NAME);
              const record: StoredSampleRecord = {
                id: remote.id,
                name: remote.name,
                blob: audioBlob!,
                mimeType: remote.mimeType || 'audio/wav',
                createdAt: remote.createdAt || Date.now(),
              };
              const req = store.put(record);
              req.onsuccess = () => res();
              req.onerror = () => rej(req.error);
            });
            downloadedCount++;
          }
        } catch (e) {
          console.warn(`Failed to fetch audio for sample ${remote.name}:`, e);
        }
      }
    }

    // Attempt to sync local custom samples to server API only if server API is live
    try {
      const isVercel = window.location.hostname.includes('vercel.app');
      if (!isVercel) {
        const remoteIds = new Set(serverSamples.map((s) => s.id));
        for (const local of localSamples) {
          if (!remoteIds.has(local.id)) {
            syncSampleToServer(local.id, local.name, local.blob).catch(() => {});
          }
        }
      }
    } catch {}

    return downloadedCount;
  } catch (err) {
    console.warn('Error syncing samples from server:', err);
    return 0;
  }
}

export interface RhythmsFetchResult {
  rhythms: unknown[];
  isStaticFallback: boolean;
}

export async function fetchRhythmsFromServer(): Promise<RhythmsFetchResult | null> {
  try {
    const resp = await fetch('/api/rhythms');
    if (resp.ok && !isHtmlResponse(resp)) {
      const data = await resp.json();
      if (Array.isArray(data.rhythms) && data.rhythms.length > 0) {
        const valid = (data.rhythms as Array<{ id?: string }>).filter(
          (r) => r && r.id && !isRhythmDeleted(r.id)
        );
        return { rhythms: valid, isStaticFallback: false };
      }
    }
  } catch {}

  // Fallback to static public/rhythms.json (default factory presets on static hosts like Vercel)
  try {
    const staticResp = await fetch('/rhythms.json');
    if (staticResp.ok && !isHtmlResponse(staticResp)) {
      const list = await staticResp.json();
      if (Array.isArray(list) && list.length > 0) {
        const valid = (list as Array<{ id?: string }>).filter(
          (r) => r && r.id && !isRhythmDeleted(r.id)
        );
        return { rhythms: valid, isStaticFallback: true };
      }
    }
  } catch (err) {
    console.warn('Failed to load rhythms from static fallback:', err);
  }
  return null;
}

export async function saveRhythmsToServer(rhythms: unknown[]): Promise<boolean> {
  try {
    const resp = await fetch('/api/rhythms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rhythms }),
    });
    return resp.ok && !isHtmlResponse(resp);
  } catch (err) {
    console.warn('Failed to save rhythms to server:', err);
    return false;
  }
}

export async function fetchActiveRhythmFromServer(): Promise<string | null> {
  try {
    const res = await fetch('/api/active_rhythm');
    if (res.ok && !isHtmlResponse(res)) {
      const data = await res.json();
      if (data.rhythmId) return data.rhythmId;
    }
  } catch {}

  try {
    const staticRes = await fetch('/active_rhythm.json');
    if (staticRes.ok && !isHtmlResponse(staticRes)) {
      const data = await staticRes.json();
      if (data.rhythmId) return data.rhythmId;
    }
  } catch (e) {
    console.warn('Failed to fetch active rhythm:', e);
  }
  return null;
}

export async function saveActiveRhythmToServer(rhythmId: string): Promise<void> {
  try {
    await fetch('/api/active_rhythm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rhythmId }),
    });
  } catch (e) {
    console.warn('Failed to save active rhythm to server:', e);
  }
}

/**
 * Exports entire user library (Rhythms + Audio Samples in Base64) as a portable JSON file.
 * Enables 1-click transfer between PC and Mobile even without login.
 */
export async function exportFullLibraryBackup(): Promise<void> {
  const localRhythmsStr = localStorage.getItem('beatbuddy_rhythms');
  const rhythms = localRhythmsStr ? JSON.parse(localRhythmsStr) : [];
  const storedSamples = await getAllStoredSamples();

  const samplesWithAudio = await Promise.all(
    storedSamples.map(async (s) => ({
      id: s.id,
      name: s.name,
      mimeType: s.mimeType,
      audioBase64: await blobToBase64(s.blob),
    }))
  );

  const backupData = {
    app: 'BeatBuddy Studio',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    rhythms,
    samples: samplesWithAudio,
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `beatbuddy_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Imports a previously exported full library backup
 */
export async function importFullLibraryBackup(file: File): Promise<{
  rhythmsCount: number;
  samplesCount: number;
}> {
  const text = await file.text();
  const data = JSON.parse(text);

  let rhythmsCount = 0;
  let samplesCount = 0;

  if (Array.isArray(data.rhythms) && data.rhythms.length > 0) {
    const existingStr = localStorage.getItem('beatbuddy_rhythms');
    const existing: Array<{ id: string }> = existingStr ? JSON.parse(existingStr) : [];
    const map = new Map<string, unknown>();
    existing.forEach((r) => map.set(r.id, r));
    data.rhythms.forEach((r: { id: string }) => map.set(r.id, r));
    const merged = Array.from(map.values());
    localStorage.setItem('beatbuddy_rhythms', JSON.stringify(merged));
    rhythmsCount = data.rhythms.length;
  }

  if (Array.isArray(data.samples) && data.samples.length > 0) {
    const { base64ToBlob } = await import('../services/firebaseSyncService');
    for (const s of data.samples) {
      if (s.id && s.name && s.audioBase64) {
        const blob = base64ToBlob(s.audioBase64, s.mimeType || 'audio/wav');
        await saveSampleToStorage(s.id, s.name, blob);
        samplesCount++;
      }
    }
  }

  return { rhythmsCount, samplesCount };
}
