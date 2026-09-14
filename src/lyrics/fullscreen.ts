import { store } from '../store/store';
import { uiActions } from '../store/slices/offlineUi';

let revision = 0;
let exitTask: Promise<void> | undefined;
const delay = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve,
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : milliseconds));

export async function enterLyricsFullscreen(): Promise<boolean> {
  const current = ++revision;
  store.dispatch(uiActions.setLyricsFullscreen(true));
  store.dispatch(uiActions.setLyricsMotion('enter'));
  let native = true;
  try {
    if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else native = false;
  } catch { native = false; }
  await delay(380);
  if (current === revision) store.dispatch(uiActions.setLyricsMotion(null));
  return native;
}

export function exitLyricsFullscreen(): Promise<void> {
  if (exitTask) return exitTask;
  if (!store.getState().ui.lyricsFullscreen) return Promise.resolve();
  const current = ++revision;
  exitTask = (async () => {
    store.dispatch(uiActions.setLyricsMotion('exit'));
    await delay(240);
    if (current !== revision) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    if (current !== revision) return;
    store.dispatch(uiActions.setLyricsFullscreen(false));
    store.dispatch(uiActions.setLyricsMotion('return'));
    await delay(300);
    if (current === revision) store.dispatch(uiActions.setLyricsMotion(null));
  })().finally(() => { exitTask = undefined; });
  return exitTask;
}

export function resetLyricsFullscreen() {
  revision++;
  store.dispatch(uiActions.setLyricsFullscreen(false)); store.dispatch(uiActions.setLyricsMotion(null));
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}
