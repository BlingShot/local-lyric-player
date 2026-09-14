import { useSyncExternalStore } from 'react';

export const deepSeekModels = [
  { value: 'deepseek-flash', label: 'DeepSeek Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
] as const;
export interface DeepSeekConfig { apiKey: string; model: typeof deepSeekModels[number]['value']; language: 'auto' | 'en' | 'zh' }
// Desktop credentials are encrypted by the main process in config.json.
let config: DeepSeekConfig = { apiKey: '', model: 'deepseek-flash', language: 'auto' };
let status = { ready: !window.localMusicDesktop, error: '', path: '' };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getDeepSeekConfig = () => config;
export const useDeepSeekConfig = () => useSyncExternalStore(subscribe, getDeepSeekConfig);
export const useDeepSeekConfigStatus = () => useSyncExternalStore(subscribe, () => status);
export async function initializeDeepSeekConfig() {
  if (!window.localMusicDesktop) return;
  try {
    const path = await window.localMusicDesktop.configPath();
    status = { ...status, path };
    const saved = await window.localMusicDesktop.getConfig<DeepSeekConfig>('deepseek');
    if (saved) config = validated(saved);
    status = { ...status, ready: true, error: '' };
  } catch (error) { status = { ...status, ready: true, error: error instanceof Error ? error.message : 'Saved API settings could not be read.' }; }
  listeners.forEach(listener => listener());
}
function validated(next: DeepSeekConfig): DeepSeekConfig {
  const apiKey = next.apiKey.trim();
  if (apiKey && (!/^[\x21-\x7e]+$/.test(apiKey) || apiKey.length > 512)) throw new Error('Enter a valid API key without spaces.');
  if (!deepSeekModels.some(model => model.value === next.model)) throw new Error('Choose a supported DeepSeek model.');
  return { apiKey, model: next.model, language: next.language === 'zh' ? 'zh' : next.language === 'en' ? 'en' : 'auto' };
}
export async function updateDeepSeekConfig(next: DeepSeekConfig) {
  const value = validated(next);
  if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('deepseek', value);
  config = value;
  status = { ...status, error: '' };
  listeners.forEach(listener => listener());
}
