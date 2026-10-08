import { EmptyState, Screen } from '@aidooi/ui-native';
import { useTx } from '../i18n/useTx.ts';

/** Placeholder for tabs whose screens are built next (orders, account). Replace the route file, not this. */
export function ComingNext({ title }: { title: string }) {
  const t = useTx();
  return (
    <Screen>
      <EmptyState title={title} message={t('comingNext')} />
    </Screen>
  );
}
