import { t } from '../../i18n';
import { useState, type FormEvent } from 'react';
import { Modal } from 'antd';
import { type LocalTrack } from '../../library/importFiles';
import { editAudioTracks, type TrackEdits } from '../../player/runtime';
import { useAppSelector } from '../../store/store';

export function TrackEditor({ tracks, albumOnly = false, onClose, onSaved }: {
  tracks: LocalTrack[]; albumOnly?: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const first = tracks[0];
  const [values, setValues] = useState<TrackEdits>({ name: first.name, artist: first.artist || '',
    album: first.album || '', albumArtist: first.albumArtist || '', trackNumber: first.trackNumber,
    discNumber: first.discNumber, releaseDate: first.releaseDate || '', compilation: first.compilation || false,
    albumGroup: first.albumGroup || '' });
  const [image, setImage] = useState<File>();
  const [saving, setSaving] = useState(false);
  const error = useAppSelector(state => state.library.storageError);
  const textInput = (key: 'name' | 'artist' | 'album' | 'albumArtist' | 'releaseDate' | 'albumGroup', label: string) =>
    <label>{t(label)}<input value={values[key] || ''} maxLength={500}
      onChange={event => setValues({ ...values, [key]: event.target.value })} /></label>;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    const edits: Partial<TrackEdits> = { album: values.album?.trim() || undefined,
      albumArtist: values.albumArtist?.trim() || undefined, releaseDate: values.releaseDate?.trim() || undefined,
      compilation: values.compilation, albumGroup: values.albumGroup?.trim() || undefined };
    if (!albumOnly) Object.assign(edits, { name: values.name.trim(), artist: values.artist?.trim() || undefined,
      trackNumber: values.trackNumber, discNumber: values.discNumber });
    const success = await editAudioTracks(tracks.map(track => track.id), edits, image);
    setSaving(false);
    if (success) { onSaved?.(); onClose(); }
  };
  return <Modal open title={albumOnly ? t("Edit album") : t("Edit details")} onCancel={saving ? undefined : onClose}
    closable={!saving} maskClosable={!saving} keyboard={!saving} footer={null} centered>
    <form className='offline-edit-form' onSubmit={save}>
      <p>{t("Changes are saved in this player's local database. Original files stay unchanged.")}</p>
      {!albumOnly && <>{textInput('name', 'Title')}{textInput('artist', 'Track artist')}</>}
      {textInput('album', 'Album')}{textInput('albumArtist', 'Album artist')}
      {!albumOnly && <div className='offline-form-row'>{(['trackNumber', 'discNumber'] as const).map((key, index) =>
        <label key={key}>{index ? t("Disc number") : t("Track number")}<input type='number' min={1} step={1}
          value={values[key] ?? ''} onChange={event => setValues({ ...values, [key]: event.target.value ? Number(event.target.value) : undefined })} /></label>)}</div>}
      {textInput('releaseDate', 'Release date')}
      <label className='offline-checkbox'><input type='checkbox' checked={!!values.compilation}
        onChange={event => setValues({ ...values, compilation: event.target.checked })} />{t("Compilation / various artists")}</label>
      {textInput('albumGroup', 'Album grouping label (optional)')}
      <p className='offline-muted'>{t("Album name, album artist and release year determine automatic grouping. Use the same grouping label to join tracks manually, or different labels to separate editions. Without an album artist, mark compilations here to keep different performers together.")}</p>
      <label>{t("Local cover image")}<input type='file' accept='image/png,image/jpeg,image/webp,image/gif'
        disabled={tracks.every(track => track.artworkSource === 'embedded')}
        onChange={event => setImage(event.target.files?.[0])} /></label>
      <p className='offline-muted'>{t("Embedded covers take priority. Your image applies to tracks without usable embedded artwork.")}</p>
      {tracks.some(track => track.tagWarning) && <p role='note'>{tracks.find(track => track.tagWarning)?.tagWarning}</p>}
      {error && <p role='alert'>{t(error)}</p>}
      <button type='submit' className='white-button' disabled={saving}><span>{saving ? t("Saving…") : t("Save details")}</span></button>
    </form>
  </Modal>;
}
