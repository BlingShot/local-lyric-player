import { Children, isValidElement, type ReactNode } from 'react';
import { AppSelect } from '../Menu';

/** Studio choices use the same popup, keyboard controls and motion as the app menu. */
export function StudioSelect({ value, onValueChange, children, disabled, 'aria-label': label }: {
  value: string | number; onValueChange: (value: string) => void; children: ReactNode; disabled?: boolean; 'aria-label': string;
}) {
  const options = Children.toArray(children).filter(isValidElement<{ value?: string | number; children: ReactNode; disabled?: boolean }>).map(option => ({
    value: String(option.props.value ?? option.props.children), label: option.props.children, disabled: option.props.disabled,
  }));
  return <AppSelect value={String(value)} options={options} onChange={onValueChange} disabled={disabled} label={label} />;
}
