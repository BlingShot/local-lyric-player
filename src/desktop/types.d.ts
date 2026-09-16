import type { NativeCommandContext, NativeAudioResult, PlaybackErrorInfo } from '../player/playbackErrors';
export interface DesktopStorageInfo {
  dataPath: string;
  cachePath: string;
  previousDataPath?: string;
  backups?: { kind: 'data' | 'cache'; path: string }[];
  pending?: { dataPath: string; cachePath: string };
  dataBytes: number;
  cacheBytes: number;
  httpCacheBytes: number;
  memoryBytes: number;
  error?: string;
}
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<{ family: string; fullName: string; postscriptName: string; style: string }[]>;
    localMusicDesktop?: {
      nativeAudioDevices(): Promise<{ name: string; description: string }[]>;
      nativeAudioMeter(enabled: boolean): Promise<void>;
      nativeAudioEnergy(): Promise<number>;
      nativeAudioLoad(value: { id: string; bytes: ArrayBuffer; device: string; exclusive: boolean; position: number; volume: number; speed: number; context: NativeCommandContext }): Promise<NativeAudioResult>;
      nativeAudioCommand(command: 'play' | 'pause' | 'seek' | 'volume' | 'speed' | 'stop', value: number | undefined, context: NativeCommandContext): Promise<NativeAudioResult>;
      onNativeAudioState(callback: (state: { id: string; time: number; duration: number; paused: boolean; ended: boolean; ready: boolean; error?: PlaybackErrorInfo; exclusive?: boolean }) => void): () => void;
      spotifyInfo(): Promise<{ clientId: string; connected: boolean }>;
      spotifyLogin(clientId: string): Promise<{ clientId: string; connected: boolean }>;
      spotifyLogout(): Promise<void>;
      spotifyMatch(track: { name: string; artist?: string; duration?: number }): Promise<{ id: string; isrc: string } | null>;
      zoom(direction: -1 | 0 | 1): Promise<number>;
      getConfig<T>(key: string): Promise<T | undefined>;
      setConfig(key: string, value: unknown): Promise<void>;
      configPath(): Promise<string>;
      getFont(slot: FontTarget): Promise<LocalFont>;
      setFont(slot: FontTarget, font: LocalFont): Promise<void>;
      importFolderInfo(): Promise<{ name: string; path: string } | null>;
      chooseImportFolder(): Promise<{ name: string; path: string } | null>;
      startFolderScan(): Promise<string>;
      nextFolderBatch(id: string): Promise<{ done: boolean; files: { name: string; size: number; lastModified: number; relativePath: string; url: string }[] }>;
      endFolderScan(id?: string): Promise<void>;
      disconnectImportFolder(): Promise<void>;
      setWindowTheme(mode: 'dark' | 'light'): Promise<void>;
      storageInfo(): Promise<DesktopStorageInfo>;
      chooseStorage(kind: 'data' | 'cache'): Promise<DesktopStorageInfo>;
      cancelStorageChange(): Promise<DesktopStorageInfo>;
      clearCache(): Promise<DesktopStorageInfo>;
      openStorage(kind: 'data' | 'cache' | 'previous'): Promise<void>;
      applyStorageChange(): Promise<void>;
    };
  }
}
import type { FontTarget, LocalFont } from '../theme/fonts';
