import { useSurface } from '../../theme/surface';

/** The cover stays static in glass mode; no audio-reactive layer is painted. */
export function LyricBackdrop({ coverUrl }: { coverUrl?: string }) {
  const { glass } = useSurface();
  return <>{glass && <div className='lyric-backdrop' aria-hidden='true'>
    {coverUrl && <img src={coverUrl} alt='' decoding='async' draggable={false} />}
  </div>}</>;
}
