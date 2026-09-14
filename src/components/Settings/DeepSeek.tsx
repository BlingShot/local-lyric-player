import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { deepSeekModels, updateDeepSeekConfig, useDeepSeekConfig, useDeepSeekConfigStatus, type DeepSeekConfig } from '../../analysis/deepseek/config';
import { AppSelect } from '../Menu';

export function DeepSeekSettings() {
  const current = useDeepSeekConfig();
  const saved = useDeepSeekConfigStatus();
  const [draft, setDraft] = useState(current), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(current); }, [current]);
  const save = async (value = draft) => {
    setBusy(true); setMessage('');
    try { await updateDeepSeekConfig(value); setDraft(value); setError(''); setMessage(window.localMusicDesktop ? 'Saved to config.json.' : 'DeepSeek settings applied to this browser session.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not apply these settings.'); }
    finally { setBusy(false); }
  };
  return <section className='deepseek-settings'><h3>{t("DeepSeek")}</h3>
    <p>{t("Analyze selected lyrics online. Audio and covers stay on this device.")}</p>
    <label>{t("API key")}<input type='password' aria-label={t("DeepSeek API key")} autoComplete='off' spellCheck={false} maxLength={512}
      disabled={!saved.ready || busy} placeholder={t("Enter your API key")} value={draft.apiKey} onChange={event => { setDraft({ ...draft, apiKey: event.target.value }); setMessage(''); }} /></label>
    <div className='app-select-field'>{t("Model")}<AppSelect disabled={!saved.ready || busy} label={t("DeepSeek model")} value={draft.model} options={[...deepSeekModels]}
      onChange={value => { setDraft({ ...draft, model: value as DeepSeekConfig['model'] }); setMessage(''); }} /></div>
    <div className='app-select-field'>{t("Analysis language")}<AppSelect disabled={!saved.ready || busy} label={t("Analysis language")} value={draft.language} options={[{ value: 'auto', label: t("Auto detect from lyrics") }, { value: 'en', label: t("English") }, { value: 'zh', label: '简体中文' }]}
      onChange={value => { setDraft({ ...draft, language: value as DeepSeekConfig['language'] }); setMessage(''); }} /></div>
    <div className='settings-folder-actions'><button className='lyrics-import-button' disabled={!saved.ready || busy} onClick={() => void save()}>{busy ? t("Saving…") : t("Save settings")}</button>
      {(current.apiKey || saved.error) && <button className='lyrics-import-button' disabled={!saved.ready || busy} onClick={() => void save({ ...draft, apiKey: '' })}>{t("Clear key")}</button>}</div>
    <p>{window.localMusicDesktop ? t("The key is encrypted for your Windows account and restored on startup.") : t("Browser mode keeps the key only for this session. Use the desktop app to save it in config.json.")} {t("Requests run only when you click Analyze.")}</p>
    {saved.path && <p className='settings-config-path'>{t("Config:")}{' '}{saved.path}</p>}
    {message && <p role='status'>{t(message)}</p>}{(error || saved.error) && <p role='alert'>{error || saved.error}</p>}
  </section>;
}
