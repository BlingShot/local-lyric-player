import { useEffect, useState } from 'react';
import { accentFromPixels, DEFAULT_LYRICS_COLOR } from './coverColor';

const colors = new Map<string, string>();
export function useCoverColor(coverUrl?: string) {
  const [state, setState] = useState<{ url?: string; color: string }>({ color: DEFAULT_LYRICS_COLOR });
  useEffect(() => {
    if (!coverUrl) return;
    if (colors.has(coverUrl)) { setState({ url: coverUrl, color: colors.get(coverUrl)! }); return; }
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (cancelled) return;
      let color = DEFAULT_LYRICS_COLOR;
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (context) { context.drawImage(image, 0, 0, 48, 48); color = accentFromPixels(context.getImageData(0, 0, 48, 48).data); }
      } catch { /* Unreadable artwork uses the same neutral local fallback. */ }
      if (colors.size >= 32) colors.delete(colors.keys().next().value!);
      colors.set(coverUrl, color); setState({ url: coverUrl, color });
    };
    image.onerror = () => { if (!cancelled) setState({ url: coverUrl, color: DEFAULT_LYRICS_COLOR }); };
    image.src = coverUrl;
    return () => { cancelled = true; image.onload = image.onerror = null; };
  }, [coverUrl]);
  return state.url === coverUrl ? state.color : colors.get(coverUrl || '') ?? DEFAULT_LYRICS_COLOR;
}
