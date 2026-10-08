import { formatMoney } from '@aidooi/i18n';
import { useLocale } from '../locale.tsx';

/** Integer fils in, formatted dirhams out. Isolated with `<bdi>` so a price never reorders inside RTL text. */
export function Money({ fils }: { fils: number }) {
  const { locale } = useLocale();
  return (
    <bdi className="ui-money" data-fils={fils}>
      {formatMoney(fils, locale)}
    </bdi>
  );
}
