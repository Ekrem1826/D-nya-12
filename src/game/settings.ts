/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GameSettings {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  passEnabled: boolean;
  aimGuideEnabled: boolean;
}

const SETTINGS_STORAGE_KEY = 'worldcup_fiske_settings';

const DEFAULT_SETTINGS: GameSettings = {
  soundEnabled: true,
  vibrationEnabled: true,
  passEnabled: true,
  aimGuideEnabled: true,
};

type SettingsListener = (settings: GameSettings) => void;
const listeners = new Set<SettingsListener>();

export function loadSettings(): GameSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
      vibrationEnabled: typeof parsed.vibrationEnabled === 'boolean' ? parsed.vibrationEnabled : true,
      passEnabled: typeof parsed.passEnabled === 'boolean' ? parsed.passEnabled : true,
      aimGuideEnabled: typeof parsed.aimGuideEnabled === 'boolean' ? parsed.aimGuideEnabled : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(next: GameSettings): GameSettings {
  const clean: GameSettings = {
    soundEnabled: Boolean(next.soundEnabled),
    vibrationEnabled: Boolean(next.vibrationEnabled),
    passEnabled: typeof next.passEnabled === 'boolean' ? next.passEnabled : true,
    aimGuideEnabled: typeof next.aimGuideEnabled === 'boolean' ? next.aimGuideEnabled : true,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(clean));
    }
  } catch {}
  listeners.forEach((cb) => cb(clean));
  return clean;
}

export function subscribeSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
