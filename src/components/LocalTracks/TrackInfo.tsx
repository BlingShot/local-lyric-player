import { t } from '../../i18n';
import { Modal } from 'antd';
import { formatSize, formatTime, trackCover, type LocalTrack } from '../../library/importFiles';
import { technicalFields, technicalLabels, technicalValue } from '../../library/technicalInfo';

export function TechnicalInfo({ track }: { track: LocalTrack }) {
  return <dl className='track-technical-info'>{technicalFields.map(field => <div key={field}><dt>{t(technicalLabels[field])}</dt><dd>{technicalValue(track, field)}</dd></div>)}</dl>;
}
export function TrackInfo({ track, close, chooseAudio }: { track: LocalTrack; close: () => void; chooseAudio: () => void }) {
  const fields = [['Title', track.name], ['Artist', track.artist], ['Album', track.album], ['Album artist', track.albumArtist],
    ['Release date', track.releaseDate], ['Track', track.trackNumber], ['Disc', track.discNumber], ['Duration', track.duration ? formatTime(track.duration) : undefined],
    ['File name', track.fileName], ['File size', formatSize(track.size)], ['Codec', track.analysisMetadata?.codec], ['Channels', track.analysisMetadata?.channels]];
  return <Modal open centered title={t("Track info")} onCancel={close} footer={null} width={520} className='track-info-modal'>
    <div className='track-info-summary'><img src={trackCover(track)} alt='' /><div><strong>{track.name}</strong><span>{track.artist || t("Unknown artist")}</span></div></div>
    <div className='track-info-content'><dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || t("Not tagged")}</dd></div>)}</dl><TechnicalInfo track={track} /></div>
    <button className='lyrics-import-button' onClick={chooseAudio}>{t("Choose audio")}</button>
  </Modal>;
}
