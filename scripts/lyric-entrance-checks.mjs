import assert from 'node:assert/strict';

// Observe rendered frames, including ResizeObserver corrections, without focusing
// the window. No timers or state are injected into the application itself.
export async function sampleEntrance(page, selector, action) {
  return page.evaluate(async ({ selector, action }) => {
    if (action.route) {
      history.pushState(null, '', action.route); dispatchEvent(new PopStateEvent('popstate'));
    } else document.querySelector(action.button).click();
    const frames = [], until = performance.now() + 1100;
    await new Promise(resolve => {
      const sample = () => {
        const region = document.querySelector(selector), active = region?.querySelector('.lyric-row[data-active]');
        if (region?.clientWidth && region?.clientHeight && active && getComputedStyle(region).visibility !== 'hidden') {
          frames.push({ time: performance.now(), scroll: region.scrollTop,
            error: active.offsetTop - region.scrollTop - region.clientHeight * .38,
            width: region.clientWidth, height: region.clientHeight,
            gutters: [...document.querySelectorAll('[data-panel] > div')].map(el => el.offsetWidth - el.clientWidth),
          });
        }
        if (performance.now() < until) requestAnimationFrame(() => setTimeout(sample, 0)); else resolve();
      }; requestAnimationFrame(() => setTimeout(sample, 0));
    }); return frames;
  }, { selector, action });
}

export function assertEntrance(frames, name) {
  assert.ok(frames.length > 10, `${name}: rendered frames were sampled`);
  const errors = frames.map(f => Math.abs(f.error));
  assert.ok(Math.max(...errors) < 120, `${name}: must start near the current cue, including the first visible frame (${Math.max(...errors)} px)`);
  assert.ok(errors.some(e => e > 16), `${name}: arrives from nearby context, not an instant snap`);
  assert.ok(new Set(errors.map(Math.round)).size > 8, `${name}: multiple intermediate positions`);
  assert.ok(errors.slice(-5).every(e => e < 1), `${name}: settles on current cue: ${errors.slice(-5)}`);
  assert.ok(frames.every(f => f.gutters.every(g => g === 0)), `${name}: no outer panel scrollbars`);
  // There must be no overshoot/reversal after the first painted frame.
  assert.ok(errors.every((e, i) => !i || e <= errors[i - 1] + 2), `${name}: entrance must not bounce`);
  return { frames: frames.length, initialDistance: errors[0], finalDistance: errors.at(-1),
    intermediatePositions: new Set(errors.map(Math.round)).size };
}
