// Display copy only. The renderer gains no Node.js or filesystem privileges.
export const isDesktop = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);
