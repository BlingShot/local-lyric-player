import { t } from '../../i18n';
import { StudioTimeInput } from './StudioTimeInput';
import type { Millis } from '../../studio/project';
import { StudioIcon } from './StudioIcon';
export function StudioSyncTime({ value, change, label, invalid }: { value: Millis; change: (v: Millis) => void; label: string; invalid?: boolean }) {
  return <div className='studio-sync-time'>
    {[-1000, -50].map(delta => <button key={delta} title={t("{0} ms", delta)} aria-label={t("{0} {1} ms", label, delta)} disabled={value === null} onClick={() => change(Math.max(0, value! + delta))}><StudioIcon kind={delta === -1000 ? 'back-fast' : 'back'} /></button>)}
    <StudioTimeInput value={value} label={label} field='start' onChange={change} invalid={invalid} />
    {[50, 1000].map(delta => <button key={delta} title={t("+{0} ms", delta)} aria-label={t("{0} +{1} ms", label, delta)} disabled={value === null} onClick={() => change(value! + delta)}><StudioIcon kind={delta === 1000 ? 'forward-fast' : 'forward'} /></button>)}
  </div>;
}
