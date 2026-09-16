import { useLayoutEffect, useRef } from 'react';
import { t } from '../../i18n';
import { readAudioClock, subscribeAudioClock } from '../../lyrics/audioClock';
import { completedInterludeDots, interludePresentation } from '../../lyrics/interludeProgress';
import type { LyricGap } from '../../lyrics/interludes';

export function Interlude({ id, gap, active, offsetMs, onSeek }: { id: string; gap: LyricGap; active: boolean; offsetMs: number; onSeek: (time: number) => void }) {
  const row = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const element = row.current; if (!element) return;
    const dots = [...element.querySelectorAll<HTMLElement>('.lyric-dot')];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const paint = (clock: ReturnType<typeof readAudioClock>) => {
      const time = clock.time - offsetMs / 1000;
      const view = interludePresentation(gap.start, gap.end, time, reduced.matches);
      element.dataset.phase = view.phase;
      element.style.setProperty('--interlude-space', String(view.space));
      element.style.setProperty('--interlude-opacity', String(view.opacity));
      element.style.setProperty('--interlude-y', `${view.y}px`);
      element.style.setProperty('--interlude-scale', String(view.scale));
      const count = completedInterludeDots(gap.start, gap.end, time);
      const elapsed = Math.max(0, Math.min(gap.end - gap.start, time - gap.start));
      dots.forEach((dot, index) => {
        const lit = index < count;
        dot.dataset.lit = String(lit); dot.dataset.progress = lit ? '1' : '0';
        const pulse = .5 - .5 * Math.cos(elapsed * Math.PI * 2 / 2.4 - index * .24);
        dot.style.setProperty('--dot-scale', String(reduced.matches ? 1 : 1 + .12 * pulse));
      });
    };
    // Seeks and pause use the exact same clock as the lyrics, never wall timers.
    const update = () => paint(readAudioClock());
    update(); reduced.addEventListener('change', update);
    const unsubscribe = active ? subscribeAudioClock(paint) : undefined;
    return () => { unsubscribe?.(); reduced.removeEventListener('change', update); };
  }, [active, gap.start, gap.end, offsetMs]);
  return <li ref={row} className='lyric-interlude lyric-dots' data-interlude-id={`interlude:${id}`} data-kind={gap.kind} data-active={active || undefined}>
    <div className='lyric-dots-content' inert={!active || undefined}><button disabled={!active} onClick={() => onSeek(gap.end)} aria-label={t('Skip instrumental break')} title={t('Skip instrumental break')}>
      <span aria-hidden='true' className='lyric-dot' /><span aria-hidden='true' className='lyric-dot' /><span aria-hidden='true' className='lyric-dot' />
    </button></div>
  </li>;
}
