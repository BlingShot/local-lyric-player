import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { defaultTrackColumns, saveTrackColumns, storageError, validTrackColumns, type TrackColumns } from '../../library/database';
import { store, useAppSelector } from '../../store/store';
import { libraryActions } from '../../store/slices/library';

let saves: Promise<unknown> = Promise.resolve();
function persist(columns: TrackColumns) {
  store.dispatch(libraryActions.setColumns(columns));
  saves = saves.then(() => saveTrackColumns(columns)).catch(error => {
    store.dispatch(libraryActions.setStorageError(storageError(error)));
  });
}
export type Column = 'title' | 'album' | 'duration' | 'bitrate' | 'sampleRate' | 'bitsPerSample';
const allColumns: Column[] = ['title', 'album', 'bitrate', 'sampleRate', 'bitsPerSample', 'duration'];
interface Drag { column: Column; start: number; initial: number; columns: TrackColumns }

export function useTrackColumns() {
  const saved = useAppSelector(state => state.library.columns);
  const [draft, setDraft] = useState<TrackColumns>();
  const table = useRef<HTMLTableElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const latest = useRef<TrackColumns | undefined>(undefined);
  const [viewport, setViewport] = useState(0);
  useLayoutEffect(() => {
    const container = table.current?.parentElement;
    if (!container) return;
    const update = () => setViewport(container.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const reference = saved.viewport ?? ((saved.title ?? 0) + saved.album + saved.duration + 118);
  let fitted = saved;
  if (saved.title && viewport > 0 && viewport < reference - 1) {
    const albumVisible = viewport > 560;
    const durationVisible = viewport > 360;
    const fixed = (albumVisible ? 118 : 104) + (viewport > 900 ? saved.bitsPerSample : 0) + (viewport > 760 ? saved.bitrate : 0) + (viewport > 640 ? saved.sampleRate : 0);
    const duration = saved.duration;
    const available = Math.max(120, viewport - fixed - (durationVisible ? duration : 0));
    const album = albumVisible ? Math.max(80, Math.min(available - 120, available * saved.album / (saved.title + saved.album))) : saved.album;
    fitted = { ...saved, title: available - (albumVisible ? album : 0), album };
  }
  const columns = draft ?? fitted;
  const measured = (): TrackColumns => ({
    title: table.current?.querySelector<HTMLElement>('[data-column=title]')?.getBoundingClientRect().width || 300,
    album: table.current?.querySelector<HTMLElement>('[data-column=album]')?.getBoundingClientRect().width || columns.album,
    duration: table.current?.querySelector<HTMLElement>('[data-column=duration]')?.getBoundingClientRect().width || columns.duration,
    bitrate: table.current?.querySelector<HTMLElement>('[data-column=bitrate]')?.getBoundingClientRect().width || columns.bitrate,
    sampleRate: table.current?.querySelector<HTMLElement>('[data-column=sampleRate]')?.getBoundingClientRect().width || columns.sampleRate,
    bitsPerSample: table.current?.querySelector<HTMLElement>('[data-column=bitsPerSample]')?.getBoundingClientRect().width || columns.bitsPerSample,
    viewport: table.current?.parentElement?.clientWidth,
  });
  const resize = (initial: TrackColumns, column: Column, width: number) => {
    const next = validTrackColumns({ ...initial, [column]: width });
    const currentTable = table.current;
    if (!currentTable) return next;
    next.viewport = currentTable.parentElement?.clientWidth;
    const albumVisible = !!currentTable.querySelector<HTMLElement>('[data-column=album]')?.offsetWidth;
    const fixed = currentTable.rows[0].cells[0].getBoundingClientRect().width
      + currentTable.rows[0].cells[currentTable.rows[0].cells.length - 1].getBoundingClientRect().width;
    const total = fixed + allColumns.reduce((sum, key) => sum + (currentTable.querySelector<HTMLElement>(`[data-column=${key}]`)?.offsetWidth ? next[key]! : 0), 0);
    const spare = Math.max(0, (currentTable.parentElement?.clientWidth ?? 0) - total);
    // Shrinking a column gives the remaining space to another text column, never to the controls.
    if (column === 'title' && albumVisible) next.album += spare;
    else next.title! += spare;
    return next;
  };
  const start = (event: PointerEvent, column: Column) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const initial = measured();
    drag.current = { column, start: event.clientX, initial: initial[column]!, columns: initial };
    latest.current = undefined;
  };
  const move = (event: PointerEvent) => {
    if (!drag.current) return;
    const { column, start, initial, columns } = drag.current;
    if (!latest.current && Math.abs(event.clientX - start) < 1) return;
    const next = resize(columns, column, initial + event.clientX - start);
    latest.current = next; setDraft(next);
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = undefined;
    if (latest.current) persist(latest.current);
    setDraft(undefined);
  };
  const cancel = () => { drag.current = undefined; latest.current = undefined; setDraft(undefined); };
  useEffect(() => () => { drag.current = undefined; }, []);
  const reset = () => { cancel(); persist(defaultTrackColumns); };
  const keyboard = (column: Column, delta: number) => {
    const initial = measured();
    persist(resize(initial, column, initial[column]! + delta));
  };
  const fit = (column: Column) => {
    const initial = measured();
    const index = table.current?.querySelector<HTMLTableCellElement>(`[data-column=${column}]`)?.cellIndex;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context || !table.current || index === undefined) return;
    context.font = getComputedStyle(table.current).font;
    let width = column === 'title' ? 120 : 64;
    for (const row of table.current.rows) {
      const cell = row.cells[index];
      if (!cell || row.classList.contains('offline-album-group')) continue;
      const label = column === 'title' ? cell.querySelector('strong')?.textContent || cell.textContent : cell.textContent;
      width = Math.max(width, context.measureText(label || '').width + (column === 'title' ? 80 : 32));
    }
    persist(resize(initial, column, width));
  };
  const style = { '--track-title-width': columns.title ? `${columns.title}px` : 'auto',
    '--track-album-width': `${columns.album}px`, '--track-duration-width': `${columns.duration}px`,
    '--track-bitrate-width': `${columns.bitrate}px`, '--track-sampleRate-width': `${columns.sampleRate}px`, '--track-bitsPerSample-width': `${columns.bitsPerSample}px` } as CSSProperties;
  return { table, columns, style, custom: !!columns.title, start, move, end, cancel, keyboard, fit, reset };
}
