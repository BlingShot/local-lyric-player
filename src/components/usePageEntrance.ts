import { useLayoutEffect, type RefObject } from 'react';

/** Animate the existing page surface without remounting controls or the audio player. */
export function usePageEntrance(ref: RefObject<HTMLElement | null>, pageKey: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.animate(
      // Keep the scroll surface in place; translating a full-height scrollport
      // creates temporary overflow in its panel during route changes.
      [{ opacity: .5 }, { opacity: 1 }],
      { duration: 200, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
    return () => animation.cancel();
  }, [ref, pageKey]);
}
