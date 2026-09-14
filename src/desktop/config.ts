import { useSyncExternalStore } from 'react';
// Config preferences are separate from the library. Song data never travels over this bridge.
const listeners = new Set<() => void>();
let error = '';
export const useConfigReadError = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => error);
export async function configPreference<T>(key: string, legacy: T): Promise<T> {
  const desktop = window.localMusicDesktop;
  if (!desktop) return legacy;
  try {
    const value = await desktop.getConfig<T>(key);
    if (value !== undefined) return value;
    if (legacy !== undefined) await desktop.setConfig(key, legacy);
    return legacy;
  } catch (reason) {
    error = `${reason instanceof Error ? reason.message : 'Config could not be read.'} Using previous preferences or defaults for this session.`;
    listeners.forEach(listener => listener());
    return legacy;
  }
}
