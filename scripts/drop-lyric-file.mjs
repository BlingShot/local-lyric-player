import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export async function dropLyricFile(page, path) {
  const bytes = await readFile(path);
  await page.locator('.lyrics-page').evaluate((element, file) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(file.data), char => char.charCodeAt(0))], file.name, { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { name: basename(path), data: bytes.toString('base64') });
}
