import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dropdown, type DropdownProps } from 'antd';
import { useLanguage } from '../i18n';

/** The app menu, action menus and value pickers share one popup surface/motion. */
export function AppDropdown({ overlayClassName = '', menu, popupRender, open, onOpenChange, ...props }: DropdownProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const visible = open ?? internalOpen;
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!visible) return;
    // Dismiss the top popup before Escape can also close its drawer/modal.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setInternalOpen(false); onOpenChange?.(false, { source: 'trigger' });
      returnFocus.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [visible, onOpenChange]);
  return <Dropdown {...props} open={visible} onOpenChange={(next, info) => {
    if (next && !visible) returnFocus.current = document.activeElement as HTMLElement | null;
    setInternalOpen(next); onOpenChange?.(next, info);
  }} menu={menu && { ...menu, onClick: info => { info.domEvent.stopPropagation(); menu.onClick?.(info); } }}
    popupRender={node => <div onClick={event => event.stopPropagation()}>{popupRender ? popupRender(node) : node}</div>}
    overlayClassName={`app-menu ${overlayClassName}`} transitionName='app-menu-motion' />;
}
export interface SelectOption { value: string; label: ReactNode; disabled?: boolean }
export function AppSelect({ value, options, onChange, disabled, label, className = '' }: {
  value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; label: string; className?: string;
}) {
  useLanguage();
  const [open, setOpen] = useState(false), id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <AppDropdown trigger={['click']} placement='bottomLeft' open={open} disabled={disabled} autoFocus
    onOpenChange={setOpen} menu={{ id, role: 'listbox', 'aria-label': label, selectable: true, selectedKeys: [value],
      items: options.map(option => ({ key: option.value, label: option.label, disabled: option.disabled, role: 'option', 'data-value': option.value, 'aria-selected': option.value === value })),
      onClick: ({ key }) => { onChange(key); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type='button' className={`app-select ${className}`} disabled={disabled}
      role='combobox' aria-label={label} aria-haspopup='listbox' aria-controls={open ? id : undefined} aria-expanded={open}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <span>{options.find(option => option.value === value)?.label ?? value}</span>
      <svg viewBox='0 0 16 16' aria-hidden='true' width='14' height='14'><path d='m4 6 4 4 4-4' fill='none' stroke='currentColor' strokeWidth='1.5' /></svg>
    </button>
  </AppDropdown>;
}
