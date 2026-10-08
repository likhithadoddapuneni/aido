import { Banner, useT } from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { useOnline } from '../net/online.ts';

/** Say plainly that actions are paused. We do not queue: a "will send later" confirmation is a lie to a waiting buyer. */
export function OfflineBanner() {
  const t = useT(catalogue);
  return useOnline() ? null : (
    <Banner tone="warn" title={t('offline.title')} message={t('offline.message')} />
  );
}
