import { t } from '../../i18n';
import { AppDropdown } from '../Menu';
import type { ReactElement } from 'react';

import { useNavigate } from 'react-router-dom';

export function TrackContextMenu({ trackId, children }: { trackId: string; children: ReactElement }) {
  const navigate = useNavigate();
  return <AppDropdown trigger={['contextMenu']} menu={{ items: [{ key: 'analyze', label: t("Analyze") }],
    onClick: ({ domEvent }) => { domEvent.stopPropagation(); navigate(`/analyze/${encodeURIComponent(trackId)}`); } }}>
    {children}
  </AppDropdown>;
}
