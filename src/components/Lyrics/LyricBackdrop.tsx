import { useSurface } from '../../theme/surface';

/** Share the same static, cover-derived glass across page, fullscreen and sidebar. */
export function LyricBackdrop({ coverUrl }: { coverUrl?: string }) {
  const { glass } = useSurface();
  if (!glass) return null;
  return <div className='lyric-backdrop' aria-hidden='true'>
    {coverUrl && <img src={coverUrl} alt='' decoding='async' draggable={false} />}
  </div>;
}
