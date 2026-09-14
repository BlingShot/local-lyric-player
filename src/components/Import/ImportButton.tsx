import { t } from '../../i18n';
import { useAppDispatch } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';

export function ImportButton({ compact = false }: { compact?: boolean }) {
  const dispatch = useAppDispatch();
  return (
    <button type='button' className={compact ? 'offline-icon-button' : 'white-button offline-import-button'}
      aria-label={t("Import music")} title={t("Import music")} onClick={() => dispatch(uiActions.openImport())}>
      {compact ? <span aria-hidden='true'>＋</span> : t("Import music")}
    </button>
  );
}
