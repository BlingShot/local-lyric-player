import { useRef, useState } from 'react';
import { exportTransfer } from '../../transfer/export';

export function TransferSettings() {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  async function run() {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) { setMessage('This environment does not support folder export. Open this library in a browser/runtime with the File System Access API.'); return; }
    setBusy(true);
    try {
      const destination = await picker({ mode: 'readwrite' });
      controller.current = new AbortController();
      await exportTransfer(destination, controller.current.signal, setMessage);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { controller.current = null; setBusy(false); }
  }
  return <section><h3>iOS transfer / 迁移到 iOS</h3>
    <p>Export audio copies, artwork, saved lyrics and playlists. Studio projects/recoveries and analysis remain on this device. API keys and tokens are excluded.</p>
    <button disabled={busy} onClick={() => void run()}>Export transfer folder / 导出迁移文件夹</button>
    {busy && <button onClick={() => controller.current?.abort()}>Cancel / 取消</button>}
    {message && <p role='status'>{message}</p>}
  </section>;
}
