import { t } from '../../i18n';
import { useState } from 'react';
import { Modal } from 'antd';
import { pastedLines, type StudioLine } from '../../studio/model';

export function StudioPaste({ close, apply }: { close: () => void; apply: (lines: StudioLine[], append: boolean) => void }) {
  const [text, setText] = useState(''), [error, setError] = useState('');
  const submit = (append: boolean) => {
    try { const lines = pastedLines(text); if (!lines.length) throw new Error('Paste or type some lyrics first.'); apply(lines, append); }
    catch (error) { setError(error instanceof Error ? error.message : 'The lyrics could not be added.'); }
  };
  return <Modal open title={t("Paste lyrics")} onCancel={close} footer={null} width={680}>
    <p>{t("One lyric line per line of text. Blank lines are skipped. You can undo a replacement.")}</p>
    <textarea className='studio-paste-text' aria-label={t("Paste whole lyrics")} value={text} maxLength={1_000_000} rows={12} onChange={event => setText(event.target.value)} autoFocus />
    {error && <p role='alert'>{t(error)}</p>}
    <div className='studio-modal-actions'><button className='lyrics-import-button' onClick={() => submit(true)}>{t("Append lyrics")}</button><button className='white-button' onClick={() => submit(false)}>{t("Use lyrics")}</button></div>
  </Modal>;
}

export function StudioImportPreview({ lines, notices, close, apply }: { lines: StudioLine[]; notices: string[]; close: () => void; apply: () => void }) {
  return <Modal open title={t("Import into Lyric Studio")} onCancel={close} footer={null}>
    <p>{lines.length} {t("lines with existing start times. This replaces the current draft; Undo restores it.")}</p>
    {!!notices.length && <div className='studio-import-notices' role='note'><h3>{t("Before you continue")}</h3><ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></div>}
    <p className='studio-import-sample'>{lines.slice(0, 3).map(line => line.text).join('\n')}</p>
    <div className='studio-modal-actions'><button className='white-button' onClick={apply}>{t("Use line timings")}</button></div>
  </Modal>;
}
