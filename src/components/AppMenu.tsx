import { t } from '../i18n';
import { AppDropdown } from './Menu';

import { useNavigate } from 'react-router-dom';
import { appLogoPaths, setThemeMode, useAppTheme } from '../theme';

export function AppMenu() {
  const navigate = useNavigate();
  const { mode } = useAppTheme();
  return <AppDropdown trigger={['click']} placement='bottomLeft' menu={{ items: [
    { key: '/', label: t("Music player") }, { key: '/studio', label: t("Lyric Studio") },
    { type: 'divider' }, { key: 'theme', label: mode === 'dark' ? 'Day mode' : 'Night mode' },
  ], onClick: ({ key }) => { if (key === 'theme') setThemeMode(mode === 'dark' ? 'light' : 'dark'); else navigate(key); } }}>
    <button className='offline-brand' aria-label={t("Open app menu")} title={t("App menu")}><img src={appLogoPaths[mode]} width={48} height={48} alt='' /></button>
  </AppDropdown>;
}
