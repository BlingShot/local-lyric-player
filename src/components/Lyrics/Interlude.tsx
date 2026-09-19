import { useLayoutEffect, useRef } from 'react';
import { t } from '../../i18n';
import { readAudioClock, subscribeAudioClock } from '../../lyrics/audioClock';
import { completedInterludeDots, interludePresentation } from '../../lyrics/interludeProgress';
import type { LyricGap } from '../../lyrics/interludes';

const HIDDEN = { phase: 'hidden', space: 0, opacity: 0, y: 0, scale: 1 };
const ease = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
const SEEK_EXIT_MS = 560;

export function Interlude({ id, gap, active, offsetMs, onSeek }: { id: string; gap: LyricGap; active: boolean; offsetMs: number; onSeek: (time: number) => void }) {
  const row = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const element = row.current; if (!element) return;
    const dots = [...element.querySelectorAll<HTMLElement>('.lyric-dot')];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let last = { ...HIDDEN }, frame = 0, wasVisible = false;
    let entrance: number | undefined;
    let departure: { at: number; from: typeof HIDDEN } | undefined;
    const apply = (view: typeof HIDDEN) => {
      last = view; element.dataset.phase = view.phase;
      element.style.setProperty('--interlude-space', String(view.space));
      element.style.setProperty('--interlude-opacity', String(view.opacity));
      element.style.setProperty('--interlude-y', `${view.y}px`);
      element.style.setProperty('--interlude-scale', String(view.scale));
    };
    const paintDots = (time: number) => {
      const count = completedInterludeDots(gap.start, gap.end, time);
      const elapsed = Math.max(0, Math.min(gap.end - gap.start, time - gap.start));
      dots.forEach((dot, index) => {
        const lit = index < count;
        dot.dataset.lit = String(lit); dot.dataset.progress = lit ? '1' : '0';
        const pulse = .5 - .5 * Math.cos(elapsed * Math.PI * 2 / 2.4 - index * .24);
        dot.style.setProperty('--dot-scale', String(reduced.matches ? 1 : 1 + .12 * pulse));
      });
    };
    const animate = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); };
    const paint = () => {
      const now = performance.now(), time = readAudioClock().time - offsetMs / 1000;
      const view = interludePresentation(gap.start, gap.end, time, reduced.matches);
      if (view.phase === 'hidden' || time >= gap.end) {
        entrance = undefined; wasVisible = false;
        if (reduced.matches || !departure && last.space < .001) { departure = undefined; apply(HIDDEN); return; }
        // Capture once. Clock samples and React's active flag must not restart an exit.
        if (!departure && time >= gap.end) paintDots(gap.end);
        departure ??= { at: now, from: { ...last } };
        const progress = (now - departure.at) / SEEK_EXIT_MS, from = departure.from;
        const fade = ease(progress / .62), collapse = ease((progress - .48) / .52);
        if (progress >= 1) { departure = undefined; apply(HIDDEN); return; }
        apply({ phase: 'leaving', space: from.space * (1 - collapse),
          opacity: from.opacity * (1 - fade), y: from.y - fade * 10, scale: from.scale * (1 - fade * .14) });
        animate(); return;
      }
      departure = undefined;
      if (!wasVisible && view.phase !== 'leaving' && !reduced.matches) entrance = now;
      wasVisible = true;
      const entry = entrance === undefined ? 1 : ease((now - entrance) / 440);
      if (entry >= 1) entrance = undefined;
      apply({ ...view, opacity: view.opacity * entry, y: view.y + (1 - entry) * 6, scale: view.scale * (.94 + .06 * entry) });
      paintDots(time);
      if (entrance !== undefined) animate();
    };
    // Keep the same observer through the active -> inactive boundary. It also
    // handles seeking while paused and a view mounted halfway through a gap.
    const unsubscribe = subscribeAudioClock(paint);
    reduced.addEventListener('change', paint);
    return () => { cancelAnimationFrame(frame); unsubscribe(); reduced.removeEventListener('change', paint); };
  }, [gap.start, gap.end, offsetMs]);
  return <li ref={row} className='lyric-interlude lyric-dots' data-phase='hidden' data-interlude-id={`interlude:${id}`} data-kind={gap.kind} data-active={active || undefined}>
    <div className='lyric-dots-content' inert={!active || undefined}><button aria-disabled={!active} tabIndex={active ? 0 : -1} onClick={() => { if (active) onSeek(gap.end); }} aria-label={t('Skip instrumental break')} title={t('Skip instrumental break')}>
      <span aria-hidden='true' className='lyric-dot' /><span aria-hidden='true' className='lyric-dot' /><span aria-hidden='true' className='lyric-dot' />
    </button></div>
  </li>;
}
