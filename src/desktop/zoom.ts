// Native Chromium page zoom keeps hit targets and layout in the same coordinate space.
export function initializeDesktopZoom() {
  const desktop = window.localMusicDesktop; if (!desktop) return;
  let last = -Infinity;
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault(); event.stopPropagation();
    const now = performance.now(); if (now - last < 70) return; last = now;
    void desktop.zoom(event.deltaY < 0 ? 1 : -1);
  };
  const key = (event: KeyboardEvent) => {
    if (!event.ctrlKey || event.altKey || !['0', '+', '=', '-'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    void desktop.zoom(event.key === '0' ? 0 : event.key === '-' ? -1 : 1);
  };
  window.addEventListener('wheel', wheel, { capture: true, passive: false }); window.addEventListener('keydown', key, true);
  if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('wheel', wheel, true); window.removeEventListener('keydown', key, true); });
}
