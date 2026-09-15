import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** A damped, retargetable scroll: consecutive cues retain momentum, without bounce. */
export function useLyricFollow(targetId: string | undefined, fontKey: string, visible = true, entranceKey = '') {
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true); followingRef.current = following;
  const focus = useRef(targetId); focus.current = targetId;
  const shown = useRef(visible); shown.current = visible;
  const reduced = useRef(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const entrance = useRef({ pending: true, active: false });
  const resizing = useRef(false);
  const motion = useRef({ frame: 0, target: 0, position: 0, velocity: 0, time: 0 });
  const stop = useCallback(() => { cancelAnimationFrame(motion.current.frame); motion.current.frame = 0; motion.current.velocity = 0; }, []);
  const align = useCallback((smooth: boolean, reflow = false) => {
    if (!shown.current) return;
    const container = viewport.current;
    const target = container && [...container.querySelectorAll<HTMLElement>('[data-line-id], [data-interlude-id]')]
      .find(element => (element.dataset.interludeId || element.dataset.lineId) === focus.current);
    if (!container || !target || !container.clientWidth || !container.clientHeight) return;
    // Use layout coordinates: fullscreen's scale/translation must not change the
    // scroll destination. The positioned scrollport owns the offset-parent chain.
    let offset = 0;
    for (let element: HTMLElement | null = target; element && element !== container; element = element.offsetParent as HTMLElement | null) offset += element.offsetTop;
    const group = target.dataset.vocalGroup;
    const expansion = group ? [...container.querySelectorAll<HTMLElement>('[data-popout]')].filter(node => node.dataset.vocalGroup === group).reduce((height, node) => height + node.offsetHeight, 0) : 0;
    const top = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, offset + expansion / 2 - container.clientHeight * .38));
    const state = motion.current;
    if (entrance.current.pending) {
      entrance.current.pending = false; entrance.current.active = !reduced.current;
      // Arrive from nearby context, never race through the entire song from zero.
      const distance = Math.min(112, container.clientHeight * .16);
      state.position = top >= distance ? top - distance : Math.min(container.scrollHeight - container.clientHeight, top + distance);
      container.scrollTop = state.position;
      container.dataset.followReady = 'true';
    } else if (reflow && entrance.current.active) {
      // Preserve the remaining entrance distance as a sidebar opens or fullscreen
      // changes the line wrapping; only the layout anchor moves, not the spring.
      state.position += top - state.target;
      container.scrollTop = state.position;
      state.position = container.scrollTop;
    }
    state.target = top;
    if (reduced.current || (!entrance.current.active && (!smooth || resizing.current))) {
      entrance.current.active = false; stop(); state.position = top; container.scrollTop = top; return;
    }
    if (state.frame) {
      if ((top - state.position) * state.velocity < 0) state.velocity = 0;
      return;
    }
    state.position = container.scrollTop; state.time = performance.now();
    const step = (now: number) => {
      const dt = Math.min(.064, Math.max(0, (now - state.time) / 1000)); state.time = now;
      const distance = state.position - state.target, decay = Math.exp(-13 * dt);
      const movement = (state.velocity + 13 * distance) * dt;
      state.position = state.target + (distance + movement) * decay;
      state.velocity = (state.velocity - 13 * movement) * decay;
      // Reflow can shrink the available range while a lyric is moving. Never keep
      // integrating an imaginary position beyond the browser's clamped scrollTop.
      // During entrance, keep the spring's layout-relative distance until the
      // ResizeObserver reanchors it. Clamping its state to a newly shorter DOM
      // range first would apply the reflow twice and fling the cue offscreen.
      if (!entrance.current.active) state.position = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, state.position));
      container.scrollTop = state.position;
      if (Math.abs(state.position - state.target) < .25 && Math.abs(state.velocity) < 2) {
        container.scrollTop = state.target; state.frame = 0; state.velocity = 0; entrance.current.active = false;
      } else state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  }, [stop]);
  useLayoutEffect(() => {
    stop(); entrance.current = { pending: true, active: false };
    // A retained sidebar starts with zero width. Reveal its text only once the
    // first nonzero layout has been anchored, never at its stale closed position.
    if (viewport.current) viewport.current.dataset.followReady = 'false';
    if (visible) { followingRef.current = true; setFollowing(true); align(true); }
  }, [visible, entranceKey, align, stop]);
  useLayoutEffect(() => { if (following) align(true); }, [targetId, following, fontKey, align]);
  useLayoutEffect(() => {
    if (!visible) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = media.matches; if (reduced.current && followingRef.current) align(false); };
    const typography = () => { if (followingRef.current) align(false, true); };
    window.addEventListener('lyric-typography-updated', typography);
    update(); media.addEventListener('change', update);
    const container = viewport.current;
    let size = '', viewportSize = '';
    let settled: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      if (!container) return;
      const next = `${container.clientWidth}:${container.clientHeight}:${container.scrollHeight}`;
      const dimensions = `${container.clientWidth}:${container.clientHeight}`;
      if (next === size) return;
      // Sidebar transitions rewrap text on many successive frames. Pin the current
      // cue during reflow instead of repeatedly chasing it with a spring animation.
      if (entrance.current.active || entrance.current.pending) {
        if (followingRef.current) align(true, true);
      } else if (size && dimensions === viewportSize) {
        // Child vocals expand in place. Retarget the existing spring without
        // snapping the parent on every frame of the height transition.
        if (followingRef.current) align(true);
      } else if (size) {
        resizing.current = true; stop(); clearTimeout(settled);
        if (followingRef.current) align(false);
        settled = setTimeout(() => {
          resizing.current = false;
          if (followingRef.current) align(true);
        }, 160);
      } else if (followingRef.current) align(true);
      size = next; viewportSize = dimensions;
    });
    if (container) { observer.observe(container); if (container.firstElementChild) observer.observe(container.firstElementChild); }
    return () => { window.removeEventListener('lyric-typography-updated', typography); observer.disconnect(); clearTimeout(settled); resizing.current = false; media.removeEventListener('change', update); stop(); };
  }, [visible, align, stop]);
  return { viewport, following, resume: () => setFollowing(true), browse: () => {
    entrance.current = { pending: false, active: false }; stop(); setFollowing(false);
  } };
}
