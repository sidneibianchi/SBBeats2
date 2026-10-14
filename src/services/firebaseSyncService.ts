/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Firebase Auth & Cloud Firestore synchronization service for BeatBuddy Studio.
 * Synchronizes custom rhythms and percussion audio samples between PC and Mobile devices.
 */

import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
  doc,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  handleFirestoreError,
  OperationType,
  testConnection,
} from '../firebase';
import { SongProject } from '../types/rhythm';
import {
  StoredSampleRecord,
  saveSampleToStorage,
  getAllStoredSamples,
  blobToBase64,
} from '../audio/sampleStorage';
import { audioEngine } from '../audio/AudioEngine';
import { isRhythmDeleted, isSampleDeleted } from './deletionRegistry';

export interface FirebaseSyncStatus {
  user: User | null;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncedAt: number | null;
  error: string | null;
}

// Helper to convert base64 data to Blob
export function base64ToBlob(base64: string, mimeType = 'audio/wav'): Blob {
  const cleanBase64 = base64.replace(/^data:audio\/[^;]+;base64,/, '');
  const byteCharacters = atob(cleanBase64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export class FirebaseSyncService {
  private currentUser: User | null = null;
  private listeners: Array<(status: FirebaseSyncStatus) => void> = [];
  private isLoading = true;
  private isSyncing = false;
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      await testConnection();
    } catch (e) {
      console.warn('Initial connection check note:', e);
    }

    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this.isLoading = false;
      this.notify();

      if (user) {
        // Auto-sync upon login
        try {
          await this.syncAll(user);
        } catch (err) {
          console.error('Error during auto-sync:', err);
        }
      }
    });
  }

  public subscribe(cb: (status: FirebaseSyncStatus) => void): () => void {
    this.listeners.push(cb);
    cb(this.getStatus());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  public getStatus(): FirebaseSyncStatus {
    return {
      user: this.currentUser,
      isLoading: this.isLoading,
      isSyncing: this.isSyncing,
      lastSyncedAt: this.lastSyncedAt,
      error: this.lastError,
    };
  }

  public async loginWithGoogle(): Promise<User> {
    this.lastError = null;
    try {
      const res = await signInWithPopup(auth, googleProvider);
      const user = res.user;

      // Update user document in Firestore
      const userPath = `users/${user.uid}`;
      try {
        await setDoc(
          doc(db, 'users', user.uid),
          {
            id: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Musician',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }

      await this.syncAll(user);
      return user;
    } catch (err: unknown) {
      const errorStr = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/unauthorized-domain' || errorStr.includes('unauthorized-domain')) {
        this.lastError = 'Domínio Vercel não autorizado no Firebase Console. Adicione seu domínio no Firebase Console (Authentication > Settings > Authorized domains). Para transferir agora mesmo para o celular, use o botão "Sincronizar Celular (QR Code)"!';
      } else if (code === 'auth/popup-blocked' || errorStr.includes('popup-blocked')) {
        this.lastError = 'O pop-up de login foi bloqueado pelo seu navegador. Por favor, permita pop-ups para fazer login com o Google.';
      } else if (code === 'auth/popup-closed-by-user' || errorStr.includes('popup-closed-by-user')) {
        this.lastError = 'Janela de login fechada antes de concluir.';
      } else {
        this.lastError = `Erro ao conectar com a nuvem: ${errorStr}`;
      }
      this.notify();
      throw new Error(this.lastError);
    }
  }

  public async logout(): Promise<void> {
    try {
      await signOut(auth);
      this.currentUser = null;
      this.notify();
    } catch (err) {
      console.error('Logout error:', err);
      throw err;
    }
  }

  /**
   * Complete bidirectional sync between Firestore cloud and device storage (PC or Mobile)
   */
  public async syncAll(user = this.currentUser): Promise<{
    rhythmsCount: number;
    samplesCount: number;
  }> {
    if (!user) return { rhythmsCount: 0, samplesCount: 0 };

    this.isSyncing = true;
    this.lastError = null;
    this.notify();

    let rhythmsCount = 0;
    let samplesCount = 0;

    try {
      // 1. SYNC RHYTHMS
      const rhythmsColPath = `users/${user.uid}/rhythms`;
      let cloudRhythms: SongProject[] = [];
      try {
        const querySnapshot = await getDocs(collection(db, 'users', user.uid, 'rhythms'));
        querySnapshot.forEach((d) => {
          cloudRhythms.push(d.data() as SongProject);
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, rhythmsColPath);
      }

      // Read local rhythms from localStorage
      let localRhythms: SongProject[] = [];
      try {
        const stored = localStorage.getItem('beatbuddy_rhythms');
        if (stored) localRhythms = JSON.parse(stored);
      } catch {}

      // Merge rhythms: clean up any deleted cloud rhythms, then overlay active local edits
      const rhythmMap = new Map<string, SongProject>();
      for (const r of cloudRhythms) {
        if (isRhythmDeleted(r.id)) {
          // Permanently purge deleted rhythm from Firestore cloud collection
          try {
            await deleteDoc(doc(db, 'users', user.uid, 'rhythms', r.id));
          } catch {}
        } else {
          rhythmMap.set(r.id, r);
        }
      }

      // Local rhythms edited on PC take priority over older cloud snapshots
      for (const lr of localRhythms) {
        if (isRhythmDeleted(lr.id)) continue;
        rhythmMap.set(lr.id, lr);
        // Upload updated local rhythm to Firestore
        await this.saveRhythm(lr, user);
      }

      const mergedRhythms = Array.from(rhythmMap.values()).filter(
        (r) => !isRhythmDeleted(r.id)
      );
      rhythmsCount = mergedRhythms.length;
      if (mergedRhythms.length > 0) {
        localStorage.setItem('beatbuddy_rhythms', JSON.stringify(mergedRhythms));
      }

      // 2. SYNC SAMPLES (Audio Files)
      const samplesColPath = `users/${user.uid}/samples`;
      interface CloudSampleDoc {
        id: string;
        userId: string;
        name: string;
        filename?: string;
        mimeType?: string;
        size?: number;
        audioBase64?: string;
        url?: string;
        updatedAt?: string;
      }

      const cloudSamples: CloudSampleDoc[] = [];
      try {
        const querySnapshot = await getDocs(collection(db, 'users', user.uid, 'samples'));
        querySnapshot.forEach((d) => {
          cloudSamples.push(d.data() as CloudSampleDoc);
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, samplesColPath);
      }

      const localSamples = await getAllStoredSamples();
      const localSampleIds = new Set(localSamples.map((s) => s.id));

      // Download samples from Cloud to device (Mobile) ONLY if not deleted
      for (const cs of cloudSamples) {
        if (isSampleDeleted(cs.id, cs.name, cs.filename)) {
          // Permanently purge deleted sample doc from Firestore cloud
          try {
            await deleteDoc(doc(db, 'users', user.uid, 'samples', cs.id));
          } catch {}
          continue;
        }

        if (!localSampleIds.has(cs.id) && cs.audioBase64) {
          try {
            const blob = base64ToBlob(cs.audioBase64, cs.mimeType || 'audio/wav');
            await saveSampleToStorage(cs.id, cs.name, blob);
            // Also decode directly into AudioEngine with exact matching sample ID
            await audioEngine.loadSampleFromBlob(blob, cs.name, cs.id);
          } catch (e) {
            console.warn(`Failed to restore sample ${cs.name} from Firestore:`, e);
          }
        }
      }

      // Upload local samples from device (PC) to Cloud if missing in Cloud (and not deleted)
      const cloudSampleIds = new Set(cloudSamples.map((s) => s.id));
      for (const ls of localSamples) {
        if (isSampleDeleted(ls.id, ls.name)) continue;
        if (!cloudSampleIds.has(ls.id)) {
          try {
            await this.saveSampleRecord(ls, user);
          } catch (e) {
            console.warn(`Failed to upload local sample ${ls.name} to Firestore:`, e);
          }
        }
      }

      samplesCount = Math.max(cloudSamples.length, localSamples.length);

      // Re-initialize custom samples in AudioEngine
      await audioEngine.initPersistentSamples();

      this.lastSyncedAt = Date.now();
    } catch (err) {
      console.error('Firebase sync error:', err);
      this.lastError = err instanceof Error ? err.message : 'Erro na sincronização';
    } finally {
      this.isSyncing = false;
      this.notify();
    }

    return { rhythmsCount, samplesCount };
  }

  /**
   * Save a rhythm to Firestore for the user
   */
  public async saveRhythm(rhythm: SongProject, user = this.currentUser): Promise<void> {
    if (!user) return;
    const rhythmPath = `users/${user.uid}/rhythms/${rhythm.id}`;
    try {
      await setDoc(
        doc(db, 'users', user.uid, 'rhythms', rhythm.id),
        {
          id: rhythm.id,
          userId: user.uid,
          name: rhythm.name,
          bpm: rhythm.bpm,
          swing: rhythm.swing || 0,
          timeSignature: rhythm.timeSignature || '4/4',
          steps: rhythm.defaultStepCount || 16,
          isFactory: false,
          tracks: rhythm.tracks || [],
          tags: [rhythm.genre || 'Percussion'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Store entire project parts payload for full fidelity reproduction
          parts: rhythm.parts,
          genre: rhythm.genre,
          resolution: rhythm.resolution,
          barsCount: rhythm.barsCount,
          humanize: rhythm.humanize,
          accentSound: rhythm.accentSound,
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, rhythmPath);
    }
  }

  /**
   * Save a sample record to Firestore
   */
  public async saveSampleRecord(
    record: StoredSampleRecord,
    user = this.currentUser
  ): Promise<void> {
    if (!user) return;
    const samplePath = `users/${user.uid}/samples/${record.id}`;
    try {
      const base64 = await blobToBase64(record.blob);
      // Ensure payload fits within Firestore doc size limit (~1MB limit, 800KB max base64)
      if (base64.length > 950000) {
        console.warn(`Sample ${record.name} is too large for Firestore document directly (${base64.length} chars)`);
        return;
      }

      await setDoc(
        doc(db, 'users', user.uid, 'samples', record.id),
        {
          id: record.id,
          userId: user.uid,
          name: record.name,
          filename: `${record.id}.wav`,
          mimeType: record.mimeType || 'audio/wav',
          size: record.blob.size,
          audioBase64: base64,
          url: `/samples/${record.id}.wav`,
          createdAt: new Date(record.createdAt || Date.now()).toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, samplePath);
    }
  }

  /**
   * Delete a sample from Firestore
   */
  public async deleteSample(sampleId: string, user = this.currentUser): Promise<void> {
    if (!user) return;
    const samplePath = `users/${user.uid}/samples/${sampleId}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'samples', sampleId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, samplePath);
    }
  }

  /**
   * Delete a rhythm from Firestore
   */
  public async deleteRhythm(rhythmId: string, user = this.currentUser): Promise<void> {
    if (!user) return;
    const rhythmPath = `users/${user.uid}/rhythms/${rhythmId}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'rhythms', rhythmId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, rhythmPath);
    }
  }
}

export const firebaseSyncService = new FirebaseSyncService();
