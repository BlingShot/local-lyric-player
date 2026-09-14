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
      zoom(direction: -1 | 0 | 1): Promise<number>;
      getConfig<T>(key: string): Promise<T | undefined>;
      setConfig(key: string, value: unknown): Promise<void>;
      configPath(): Promise<string>;
      getFont(slot: FontTarget): Promise<LocalFont>;
      setFont(slot: FontTarget, font: LocalFont): Promise<void>;
      importFolderInfo(): Promise<{ name: string; path: string } | null>;
      chooseImportFolder(): Promise<{ name: string; path: string } | null>;
      startFolderScan(): Promise<string>;
      nextFolderBatch(id: string): Promise<{ done: boolean; files: { name: string; size: number; lastModified: number; url: string }[] }>;
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
