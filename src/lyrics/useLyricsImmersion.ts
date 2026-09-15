import { useEffect } from 'react';
import { useAppDispatch } from '../store/store';
import { uiActions } from '../store/slices/offlineUi';

const idleMs = 10000;
export function useLyricsImmersion(enabled: boolean, blocked: boolean) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(uiActions.setLyricsImmersive(false));
    if (!enabled || blocked) return;
    let hidden = false, deadline = performance.now() + idleMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointer: { x: number; y: number } | undefined;
    const interactionOpen = () => {
      const editing = document.activeElement instanceof Element &&
        document.activeElement.matches('input, textarea, select, [contenteditable=true], [role=slider]');
      return editing || [...document.querySelectorAll<HTMLElement>('[role=dialog], [role=menu], .ant-dropdown:not(.ant-dropdown-hidden)')]
        .some(element => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);
    };
    function arm() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(check, Math.max(0, deadline - performance.now()));
    }
    function check() {
      timer = undefined;
      if (document.hidden || interactionOpen()) deadline = performance.now() + idleMs;
      if (performance.now() < deadline) { arm(); return; }
      hidden = true;
      dispatch(uiActions.setLyricsImmersive(true));
    }
    const wake = () => {
      deadline = performance.now() + idleMs;
      if (hidden) { hidden = false; dispatch(uiActions.setLyricsImmersive(false)); }
      if (timer === undefined) arm();
    };
    const move = (event: PointerEvent) => {
      if (pointer?.x === event.clientX && pointer.y === event.clientY && !event.movementX && !event.movementY) return;
      pointer = { x: event.clientX, y: event.clientY }; wake();
    };
    arm();
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', wake, { passive: true });
    document.addEventListener('wheel', wake, { passive: true });
    document.addEventListener('keydown', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('wheel', wake);
      document.removeEventListener('keydown', wake);
      document.removeEventListener('visibilitychange', wake);
      dispatch(uiActions.setLyricsImmersive(false));
    };
  }, [enabled, blocked, dispatch]);
}
