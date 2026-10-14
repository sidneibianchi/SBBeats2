/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Drum Kit Persistence & Management Service.
 * Allows creating, editing, and saving custom drum kits in local browser memory.
 */

import { DrumKitDefinition } from '../types/kit';
import { TrackDefinition } from '../types/rhythm';

const USER_KITS_STORAGE_KEY = 'beatbuddy_user_drum_kits_v1';

// Factory kits are removed per user request
export const FACTORY_DRUM_KITS: DrumKitDefinition[] = [];

/**
 * Loads user custom kits from LocalStorage
 */
export function getUserDrumKits(): DrumKitDefinition[] {
  try {
    const raw = localStorage.getItem(USER_KITS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filter out any legacy factory kits if present in localStorage
      const userOnly = parsed.filter(
        (k: DrumKitDefinition) => k && k.isUserCreated && !k.id.startsWith('kit_factory_')
      );
      if (userOnly.length !== parsed.length) {
        localStorage.setItem(USER_KITS_STORAGE_KEY, JSON.stringify(userOnly));
      }
      return userOnly;
    }
    return [];
  } catch (err) {
    console.error('Failed to load user drum kits from localStorage', err);
    return [];
  }
}

/**
 * Saves a custom drum kit to LocalStorage
 */
export function saveUserDrumKit(kit: DrumKitDefinition): void {
  try {
    const existing = getUserDrumKits();
    const index = existing.findIndex((k) => k.id === kit.id);
    const updatedKit: DrumKitDefinition = {
      ...kit,
      isUserCreated: true,
      createdAt: kit.createdAt || Date.now(),
    };

    let nextKits: DrumKitDefinition[];
    if (index >= 0) {
      nextKits = [...existing];
      nextKits[index] = updatedKit;
    } else {
      nextKits = [updatedKit, ...existing];
    }
    localStorage.setItem(USER_KITS_STORAGE_KEY, JSON.stringify(nextKits));
  } catch (err) {
    console.error('Failed to save user drum kit to localStorage', err);
  }
}

/**
 * Deletes a user custom drum kit from LocalStorage
 */
export function deleteUserDrumKit(kitId: string): void {
  try {
    const existing = getUserDrumKits();
    const nextKits = existing.filter((k) => k.id !== kitId);
    localStorage.setItem(USER_KITS_STORAGE_KEY, JSON.stringify(nextKits));
  } catch (err) {
    console.error('Failed to delete user drum kit from localStorage', err);
  }
}

const KITS_ORDER_STORAGE_KEY = 'beatbuddy_kits_order_v1';

/**
 * Reorders drum kits list and persists preference
 */
export function reorderDrumKits(orderedIds: string[]): void {
  try {
    localStorage.setItem(KITS_ORDER_STORAGE_KEY, JSON.stringify(orderedIds));
  } catch (err) {
    console.error('Failed to save kits order to localStorage', err);
  }
}

/**
 * Returns all drum kits available (user kits + factory kits) sorted by custom preference
 */
export function getAllDrumKits(): DrumKitDefinition[] {
  const userKits = getUserDrumKits();
  const all = [...userKits, ...FACTORY_DRUM_KITS];

  try {
    const savedOrder = localStorage.getItem(KITS_ORDER_STORAGE_KEY);
    if (savedOrder) {
      const orderIds: string[] = JSON.parse(savedOrder);
      all.sort((a, b) => {
        const idxA = orderIds.indexOf(a.id);
        const idxB = orderIds.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }
  } catch {}

  return all;
}

/**
 * Exports kit definition as downloadable JSON string
 */
export function exportKitAsJson(kit: DrumKitDefinition): void {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(kit, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `${kit.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_kit.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}
