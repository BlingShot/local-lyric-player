import { useLayoutEffect, useRef } from 'react';
import { t } from '../../i18n';
import { readAudioClock, subscribeAudioClock } from '../../lyrics/audioClock';
import { completedInterludeDots } from '../../lyrics/interludeProgress';
import type { LyricGap } from '../../lyrics/interludes';

export function Interlude({ id, gap, active, offsetMs, onSeek }: { id: string; gap: LyricGap; active: boolean; offsetMs: number; onSeek: (time: number) => void }) {
  const row = useRef<HTMLLIElement>(null);
  const previous = useRef({ active: false, start: gap.start, end: gap.end });
  useLayoutEffect(() => {
    const element = row.current; if (!element) return;
    const dots = [...element.querySelectorAll<HTMLElement>('.lyric-dot')];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prior = previous.current;
    previous.current = { active, start: gap.start, end: gap.end };
    let lastCount = -1;
    const paint = (clock: ReturnType<typeof readAudioClock>) => {
      const time = clock.time - offsetMs / 1000;
      const count = completedInterludeDots(gap.start, gap.end, time);
      const elapsed = Math.max(0, Math.min(gap.end - gap.start, time - gap.start));
      dots.forEach((dot, index) => {
        if (count !== lastCount) {
          const lit = index < count;
          dot.dataset.lit = String(lit); dot.dataset.progress = lit ? '1' : '0';
        }
        // Breathing follows media time and freezes on pause; lighting stays in thirds.
        const pulse = .5 - .5 * Math.cos(elapsed * Math.PI * 2 / 2.4 - index * .24);
        dot.style.setProperty('--dot-scale', String(1 + .12 * pulse));
      });
      lastCount = count;
    };
    let unsubscribe: (() => void) | undefined;
    if (active) {
      const immediate = gap.kind === 'intro' || reduced;
      element.dataset.phase = immediate ? 'visible' : 'entering';
      if (!immediate) timers.push(setTimeout(() => { element.dataset.phase = 'visible'; }, 620));
      unsubscribe = subscribeAudioClock(paint);
    } else {
      paint(readAudioClock());
      if (prior.active && prior.start === gap.start && prior.end === gap.end && !reduced) {
        // Keep the full row until the pop-out has finished, then reclaim its space.
        element.dataset.phase = 'leaving';
        timers.push(setTimeout(() => { element.dataset.phase = 'collapsing'; }, 440));
        timers.push(setTimeout(() => { element.dataset.phase = 'hidden'; }, 760));
      } else element.dataset.phase = 'hidden';
    }
    return () => { timers.forEach(timer => clearTimeout(timer)); unsubscribe?.(); };
  }, [active, gap.start, gap.end, gap.kind, offsetMs]);
  return <li ref={row} className='lyric-interlude lyric-dots' data-interlude-id={`interlude:${id}`} data-kind={gap.kind} data-active={active || undefined}>
    <div className='lyric-dots-content' inert={!active || undefined}><button disabled={!active} onClick={() => onSeek(gap.end)} aria-label={t('Skip instrumental break')} title={t('Skip instrumental break')}>
      <span aria-hidden='true' className='lyric-dot' /><span aria-hidden='true' className='lyric-dot' /><span aria-hidden='true' className='lyric-dot' />
    </button></div>
  </li>;
}
