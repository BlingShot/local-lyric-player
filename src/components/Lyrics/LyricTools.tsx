import { AppSelect } from '../Menu';
import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import type { LyricDocument, SavedLyrics } from '../../lyrics/types';
import type { LocalTrack } from '../../library/importFiles';
import { getDeepSeekConfig } from '../../analysis/deepseek/config';
import { translateLyrics } from '../../lyrics/translate';
import { serializeLyrics } from '../../lyrics/serialize';
import { getLocalPlayer, writeLocalLyricsCopy } from '../../player/runtime';
import { LyricImageExport } from './LyricImageExport';
import './lyric-tools.css';

export function LyricTools({ saved, track }: { saved: SavedLyrics; track: LocalTrack }) {
  const [translateOpen, setTranslateOpen] = useState(false), [imageOpen, setImageOpen] = useState(false), [language, setLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  const [result, setResult] = useState<LyricDocument>(), [busy, setBusy] = useState(false), [writing, setWriting] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const job = useRef<AbortController | null>(null), snapshot = useRef(saved);
  useEffect(() => () => { job.current?.abort(); }, []);
  const close = () => { if (writing) return; job.current?.abort(); job.current = null; setBusy(false); setTranslateOpen(false); };
  const translate = async () => {
    if (busy || writing) return; const controller = new AbortController(); job.current = controller; snapshot.current = saved; setBusy(true); setResult(undefined); setError('');
    try {
      const document = await translateLyrics(saved.document, getDeepSeekConfig(), language, controller.signal, (done, total) => setMessage(t('Translating {0}/{1} lines...', done, total)));
      if (!controller.signal.aborted) { setResult(document); setMessage(''); }
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (job.current === controller) { job.current = null; setBusy(false); } }
  };
  const save = async () => {
    if (!result || writing) return; setWriting(true); setError('');
    try {
      const player = getLocalPlayer().getState(); const duration = track.duration || (player.currentId === track.id ? player.duration : 0);
      const source = serializeLyrics(result, duration, track);
      await writeLocalLyricsCopy(track.id, source, { source: snapshot.current.source, savedAt: snapshot.current.savedAt });
      setMessage('Translation saved inside the library audio copy. The original file is unchanged.'); setResult(undefined);
    } catch (e) { setError((e as Error).message); } finally { setWriting(false); }
  };
  return <>
    <button className='lyrics-import-button' onClick={() => { setTranslateOpen(true); setError(''); setMessage(''); setResult(undefined); }}>{t('AI translation')}</button>
    <button className='lyrics-import-button' onClick={() => setImageOpen(true)}>{t('Export image')}</button>
    <Modal open={translateOpen} title={t('AI lyric translation')} onCancel={close} footer={null} closable={!writing} maskClosable={!writing && !busy} width={660}>
      <div className='lyric-translation-tools'>
        <p>{t('Sends main and background lyric text to DeepSeek using your API settings. API usage may incur charges. Audio is not uploaded.')}</p>
        <label>{t('Translate to')}<AppSelect label={t('Translate to')} disabled={busy || writing} value={language} onChange={value => { setLanguage(value as typeof language); setResult(undefined); }} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} /></label>
        <button disabled={busy || writing} onClick={() => void translate()}>{t('Translate lyrics')}</button>
        {busy && <button onClick={() => { job.current?.abort(); setBusy(false); setMessage(''); }}>{t('Cancel')}</button>}
        {message && <p role='status'>{t(message)}</p>}{error && <p role='alert'>{t(error)}</p>}
        {result && <><div className='lyric-translation-preview'>{result.lines.map(line => <div key={line.id} data-role={line.role}><strong>{line.parts.map(part => part.text).join('')}</strong>{line.annotations.filter(a => a.kind === 'translation' && a.language === language).map((annotation, index) => <p key={index}>{annotation.text}</p>)}</div>)}</div>
          <p>{t('Saving replaces translations in this language and embeds TTML in the library audio copy. Original word timings and other voices are retained.')}</p>
          <button className='white-button' disabled={writing || track.unavailable} onClick={() => void save()}>{t(writing ? 'Writing translation...' : 'Save translation to song')}</button></>}
      </div>
    </Modal>
    {imageOpen && <LyricImageExport saved={saved} track={track} close={() => setImageOpen(false)} />}
  </>;
}
