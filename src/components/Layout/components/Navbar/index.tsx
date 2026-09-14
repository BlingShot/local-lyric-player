import { t } from '../../../../i18n';
import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HomeIcon, LibraryIcon, SearchIcon } from '../../../Icons';
import { ImportButton } from '../../../Import/ImportButton';
import { useAppDispatch } from '../../../../store/store';
import { uiActions } from '../../../../store/slices/offlineUi';
import { AppMenu } from '../../../AppMenu';
import { isDesktop } from '../../../../desktop/environment';

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const [params] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const query = location.pathname === '/search' ? params.get('q') ?? '' : '';
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); input.current?.focus();
      }
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);
  return (
    <nav className='navbar offline-navbar' aria-label={t("Main navigation")}>
      <div className='offline-nav-start'><AppMenu />{isDesktop && <div className='desktop-history' aria-label={t("Page history")}>
        <button className='offline-icon-button' aria-label={t("Go back")} onClick={() => navigate(-1)}><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8'><path d='m15 5-7 7 7 7' /></svg></button>
        <button className='offline-icon-button' aria-label={t("Go forward")} onClick={() => navigate(1)}><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8'><path d='m9 5 7 7-7 7' /></svg></button>
      </div>}</div>
      <button className='offline-icon-button offline-mobile-only' aria-label={t("Open library")}
        onClick={() => dispatch(uiActions.openLibraryDrawer())}><LibraryIcon /></button>
      <div className='offline-search-group'>
        <Link to='/' className='offline-home-button' aria-label={t("Home")}><HomeIcon /></Link>
        <label className='search-input offline-search'>
          <SearchIcon />
          <input ref={input} value={query} aria-label={t("Search local music")} placeholder={t("Search local music")}
            onChange={event => navigate(`/search?q=${encodeURIComponent(event.target.value)}`, { replace: location.pathname === '/search' })} />
        </label>
      </div>
      <div className='offline-nav-actions'><button className='offline-settings-button' onClick={() => dispatch(uiActions.setSettingsOpen(true))}>{t("Settings")}</button><ImportButton /></div>
    </nav>
  );
}
