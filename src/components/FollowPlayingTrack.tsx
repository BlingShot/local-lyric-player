import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../store/store';
import { PlaybackRouteFollower } from '../player/playbackRoute';

/** Follow changes in the playing song, while preserving explicit inspection links. */
export function FollowPlayingTrack() {
  const currentId = useAppSelector(state => state.player.currentId);
  const follower = useRef<PlaybackRouteFollower | null>(null);
  follower.current ??= new PlaybackRouteFollower(currentId);
  const location = useLocation(), navigate = useNavigate();
  useEffect(() => {
    const synchronize = () => {
      const target = follower.current!.update(currentId, location, document.visibilityState === 'visible' && document.hasFocus());
      if (target) navigate(target, { replace: true });
    };
    synchronize();
    // Never navigate or remount song-specific dialogs while the user is in another
    // window. On return, coalesce any queued changes to the latest playing song.
    window.addEventListener('focus', synchronize);
    document.addEventListener('visibilitychange', synchronize);
    return () => {
      window.removeEventListener('focus', synchronize);
      document.removeEventListener('visibilitychange', synchronize);
    };
  }, [currentId, location, navigate]);
  return null;
}
