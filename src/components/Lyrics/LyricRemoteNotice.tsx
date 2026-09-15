import { useEffect, useState } from 'react';
import { t } from '../../i18n';

export function LyricRemoteNotice({ status, onRetry }: { status: string; onRetry: () => void }) {
  const [lastMessage, setLastMessage] = useState(status);
  useEffect(() => { if (status) setLastMessage(status); }, [status]);
  // Retain the text during the fade, without extending the shared 3-second timeout.
  return <div className='lyrics-remote-notice' data-visible={!!status || undefined}
    aria-hidden={!status} inert={!status || undefined}>
    <p role='status' aria-live='polite' aria-atomic='true'>{t(status || lastMessage)}</p>
    <button onClick={onRetry} tabIndex={status ? 0 : -1}>{t('Search again')}</button>
  </div>;
}
