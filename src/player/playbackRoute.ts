interface PageLocation { key: string; pathname: string; search: string }

/** Song changes update a page only while its window is in the foreground. */
export class PlaybackRouteFollower {
  private previousId: string | null;
  private pending?: { trackId: string; pageKey: string };

  constructor(currentId: string | null) { this.previousId = currentId; }

  update(currentId: string | null, location: PageLocation, foreground: boolean): string | undefined {
    if (this.pending?.pageKey !== location.key) this.pending = undefined;
    const previous = this.previousId;
    this.previousId = currentId;
    if (!currentId) this.pending = undefined;
    else if (previous && previous !== currentId) {
      this.pending = location.pathname.startsWith('/analyze/') || location.pathname === '/studio'
        ? { trackId: currentId, pageKey: location.key } : undefined;
    }
    if (!foreground || !this.pending) return;
    const id = this.pending.trackId;
    this.pending = undefined;
    if (location.pathname.startsWith('/analyze/')) {
      const path = `/analyze/${encodeURIComponent(id)}`;
      return path !== location.pathname ? path : undefined;
    }
    if (location.pathname === '/studio') {
      const query = new URLSearchParams(location.search);
      if (query.get('trackId') === id) return;
      query.set('trackId', id);
      return `/studio?${query}`;
    }
  }
}
