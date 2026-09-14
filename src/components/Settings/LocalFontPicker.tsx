import { useRef, useState } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import { chooseLocalFont, cssFontFamily, installedFontFamilies, useLocalFonts, type FontTarget } from '../../theme/fonts';

export function LocalFontPicker({ target }: { target: FontTarget }) {
  const font = useLocalFonts()[target], title = target === 'app' ? 'Application font' : 'Lyric font';
  const [open, setOpen] = useState(false), [fonts, setFonts] = useState<string[]>([]), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null), busy = font.busy || loading || importing;
  const list = async () => {
    setOpen(true); setSearch(''); setError(''); setLoading(true);
    try { setFonts(await installedFontFamilies()); }
    catch { setFonts([]); setError('Installed fonts could not be read. Allow local font access or choose a font file.'); }
    finally { setLoading(false); }
  };
  return <div className='local-font-setting' data-font-target={target}>
    <h4>{t(title)}</h4><p className='local-font-name' style={{ fontFamily: font.family }} title={font.label}>{t(font.label)}</p>
    <div className='local-font-actions'>
      <button className='lyrics-import-button' disabled={busy} onClick={() => void list()}>{t('Installed fonts')}</button>
      <button className='lyrics-import-button' disabled={busy} onClick={() => file.current?.click()}>{t('Choose font file')}</button>
      <button className='analysis-text-button' disabled={busy || font.kind === 'system' && !font.error} onClick={() => void chooseLocalFont(target, { kind: 'system' })}>{t('System default')}</button>
    </div>
    <input ref={file} hidden type='file' accept='.ttf,.otf,.woff,.woff2' aria-label={t(`${title} file`)} onChange={async event => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return;
      setError(''); setImporting(true);
      try {
        if (!/\.(ttf|otf|woff2?)$/i.test(selected.name) || selected.size > 32 * 1024 * 1024) throw new Error('Invalid font');
        await chooseLocalFont(target, { kind: 'file', name: selected.name, bytes: new Uint8Array(await selected.arrayBuffer()) });
      } catch { setError('Choose a valid TTF, OTF, WOFF or WOFF2 font under 32 MB.'); }
      finally { setImporting(false); }
    }} />
    {(error || font.error) && <p role='alert'>{t(error || font.error)}</p>}
    <Modal title={t(title)} open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <input className='local-font-search' aria-label={t('Search installed fonts')} placeholder={t('Search installed fonts')} value={search} onChange={event => setSearch(event.target.value)} />
      {loading ? <p role='status'>{t('Reading installed fonts…')}</p> : <div className='local-font-list'>
        {fonts.filter(name => name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(name => <button key={name} disabled={font.busy} aria-pressed={font.kind === 'installed' && font.label === name} style={{ fontFamily: cssFontFamily(name) }} onClick={async () => {
          await chooseLocalFont(target, { kind: 'installed', family: name }); setOpen(false);
        }}>{name}</button>)}
        {!fonts.length && <p>{t(error || 'No installed fonts found.')}</p>}
      </div>}
    </Modal>
  </div>;
}
