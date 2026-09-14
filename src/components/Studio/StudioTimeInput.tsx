import { useState } from 'react';
import { t } from '../../i18n';
import { msText, textMs, type Millis } from '../../studio/project';

export function StudioTimeInput({ value, onChange, label, placeholder = 'Pending', invalid, field }: { value: Millis; onChange: (value: Millis) => void; label: string; placeholder?: string; invalid?: boolean; field?: string }) {
  const [text, setText] = useState(msText(value)), [focused, setFocused] = useState(false);
  return <input className='studio-time' data-field={field} aria-label={label} placeholder={t(placeholder)} value={focused ? text : msText(value)} maxLength={16} inputMode='decimal'
    aria-invalid={invalid || (focused && !!text && textMs(text) === null)} onFocus={() => { setText(msText(value)); setFocused(true); }} onBlur={() => setFocused(false)} onChange={e => { setText(e.target.value); onChange(textMs(e.target.value)); }} />;
}
