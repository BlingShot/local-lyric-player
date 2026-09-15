import { useRef } from 'react';
import { useMusicPulse } from '../../lyrics/useMusicPulse';
import { useSurface } from '../../theme/surface';

/** The cover stays static; optional audio energy paints a separate, dim layer. */
export function LyricBackdrop({ coverUrl, reactive = false }: { coverUrl?: string; reactive?: boolean }) {
  const { glass } = useSurface();
  const pulse = useRef<HTMLDivElement>(null);
  useMusicPulse(pulse, reactive);
  return <>{glass && <div className='lyric-backdrop' aria-hidden='true'>
    {coverUrl && <img src={coverUrl} alt='' decoding='async' draggable={false} />}
  </div>}
    {reactive && <div ref={pulse} className='lyric-music-pulse' aria-hidden='true' />}
  </>;
}
