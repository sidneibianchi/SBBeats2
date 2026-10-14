/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Deletion Registry Service.
 * Tracks user-deleted rhythms and custom samples so that sync routines (server, static fallback, and Firebase)
 * NEVER resurrect or restore items that the user has intentionally deleted.
 */

const DELETED_RHYTHMS_KEY = 'beatbuddy_deleted_rhythms_v1';
const DELETED_SAMPLES_KEY = 'beatbuddy_deleted_samples_v1';

/**
 * Retrieves the set of deleted rhythm IDs
 */
export function getDeletedRhythmIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_RHYTHMS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/**
 * Marks a rhythm ID as permanently deleted
 */
export function markRhythmAsDeleted(rhythmId: string): void {
  if (!rhythmId) return;
  try {
    const current = getDeletedRhythmIds();
    current.add(rhythmId);
    localStorage.setItem(DELETED_RHYTHMS_KEY, JSON.stringify(Array.from(current)));
  } catch (err) {
    console.error('Failed to mark rhythm as deleted:', err);
  }
}

/**
 * Checks whether a rhythm was marked as deleted
 */
export function isRhythmDeleted(rhythmId: string): boolean {
  if (!rhythmId) return false;
  return getDeletedRhythmIds().has(rhythmId);
}

/**
 * Unmarks a rhythm from deleted list (e.g. if explicitly recreated or re-imported)
 */
export function unmarkRhythmAsDeleted(rhythmId: string): void {
  try {
    const current = getDeletedRhythmIds();
    if (current.delete(rhythmId)) {
      localStorage.setItem(DELETED_RHYTHMS_KEY, JSON.stringify(Array.from(current)));
    }
  } catch {}
}

/**
 * Retrieves the set of deleted sample identifiers (IDs, names, filenames)
 */
export function getDeletedSampleIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_SAMPLES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/**
 * Normalizes a sample identifier for fuzzy matching
 */
function normalizeSampleKey(key: string): string {
  return key.toLowerCase().replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, '').trim();
}

/**
 * Marks a sample ID, name, or filename as permanently deleted
 */
export function markSampleAsDeleted(sampleIdOrName: string, secondaryIdentifier?: string, fileName?: string): void {
  if (!sampleIdOrName) return;
  try {
    const current = getDeletedSampleIds();
    const addAllVariants = (val?: string) => {
      if (!val) return;
      const clean = val.trim();
      const lower = clean.toLowerCase();
      const stem = normalizeSampleKey(clean);
      current.add(clean);
      current.add(lower);
      current.add(stem);
      current.add(`${stem}.wav`);
    };

    addAllVariants(sampleIdOrName);
    addAllVariants(secondaryIdentifier);
    addAllVariants(fileName);

    localStorage.setItem(DELETED_SAMPLES_KEY, JSON.stringify(Array.from(current)));
  } catch (err) {
    console.error('Failed to mark sample as deleted:', err);
  }
}

/**
 * Checks whether a sample was deleted by ID, name, or filename
 */
export function isSampleDeleted(sampleId?: string, sampleName?: string, fileName?: string): boolean {
  const deleted = getDeletedSampleIds();
  if (deleted.size === 0) return false;

  const test = (val?: string) => {
    if (!val) return false;
    const clean = val.trim();
    const lower = clean.toLowerCase();
    const stem = normalizeSampleKey(clean);
    return deleted.has(clean) || deleted.has(lower) || deleted.has(stem) || deleted.has(`${stem}.wav`);
  };

  return test(sampleId) || test(sampleName) || test(fileName);
}

/**
 * Unmarks a sample from deleted list (e.g. if the user intentionally re-uploads or creates a new sample with the same name)
 */
export function unmarkSampleAsDeleted(sampleId: string): void {
  try {
    const current = getDeletedSampleIds();
    const stem = normalizeSampleKey(sampleId);
    current.delete(sampleId);
    current.delete(sampleId.toLowerCase());
    current.delete(stem);
    current.delete(`${stem}.wav`);
    localStorage.setItem(DELETED_SAMPLES_KEY, JSON.stringify(Array.from(current)));
  } catch {}
}

/**
 * Synchronizes deleted registry from server API
 */
export async function syncDeletedRegistryFromServer(): Promise<void> {
  try {
    const resp = await fetch('/api/deleted_registry');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && Array.isArray(data.deletedRhythms)) {
      const currentR = getDeletedRhythmIds();
      data.deletedRhythms.forEach((id: string) => currentR.add(id));
      localStorage.setItem(DELETED_RHYTHMS_KEY, JSON.stringify(Array.from(currentR)));
    }
    if (data && Array.isArray(data.deletedSamples)) {
      const currentS = getDeletedSampleIds();
      data.deletedSamples.forEach((s: string) => {
        currentS.add(s);
        currentS.add(s.toLowerCase());
        currentS.add(normalizeSampleKey(s));
      });
      localStorage.setItem(DELETED_SAMPLES_KEY, JSON.stringify(Array.from(currentS)));
    }
  } catch {}
}
