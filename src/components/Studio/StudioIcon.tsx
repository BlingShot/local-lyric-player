export function StudioIcon({ kind }: { kind: 'close' | 'play' | 'back' | 'forward' | 'back-fast' | 'forward-fast' }) {
  const back = kind.startsWith('back');
  return <svg aria-hidden='true' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
    {kind === 'close' ? <path d='m6 6 12 12M6 18 18 6' /> : kind === 'play' ? <path d='m9 5 10 7-10 7Z' fill='currentColor' stroke='none' /> :
      <g transform={back ? undefined : 'translate(24 0) scale(-1 1)'}>{kind.endsWith('fast') ? <path d='m11 5-7 7 7 7m9-14-7 7 7 7' /> : <path d='m15 5-7 7 7 7' />}</g>}
  </svg>;
}
