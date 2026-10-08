import { unwrap } from '@aidooi/api-client';
import {
  Card,
  ErrorState,
  KeyValueList,
  PageHeader,
  Select,
  Field,
  Spinner,
  useApi,
  useLocale,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Guard } from '../components/Guard.tsx';
import { useS } from '../i18n/index.tsx';

type Period = '30d' | '90d';

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function PerformanceScreen() {
  return (
    <Guard action="viewPerformance">
      <PerformanceBody />
    </Guard>
  );
}

function PerformanceBody() {
  const s = useS();
  const api = useApi();
  const { locale } = useLocale();
  const [period, setPeriod] = useState<Period>('30d');
  const q = useQuery({
    queryKey: ['performance', period],
    queryFn: async () =>
      unwrap(api.http.GET('/v1/seller/performance', { params: { query: { period } } })),
  });
  const pct = (rate: number | null) =>
    rate === null
      ? '—'
      : new Intl.NumberFormat(locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
          style: 'percent',
          maximumFractionDigits: 0,
        }).format(rate);
  const secs = (v: number | null) => {
    if (v === null) return '—';
    return v < 3600
      ? s.fmt('minutes', { n: Math.round(v / 60) })
      : s.fmt('hours', { n: Math.round(v / 360) / 10 });
  };
  const d = q.data;
  return (
    <>
      <PageHeader title={s.navPerformance} description={s.performanceIntro} />
      <Field id="perf-period" label={s.period}>
        <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="30d">{s.last30}</option>
          <option value="90d">{s.last90}</option>
        </Select>
      </Field>
      {q.isPending ? <Spinner /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <div className="portal-grid">
          <Card title={s.purchaseConfirmations}>
            <KeyValueList
              items={[
                { key: 'requests', label: s.requests, value: d.confirmation.purchase.requests },
                { key: 'confirmed', label: s.confirmed, value: d.confirmation.purchase.confirmed },
                { key: 'rate', label: s.rate, value: pct(d.confirmation.purchase.rate) },
              ]}
            />
          </Card>
          <Card title={s.viewingConfirmations}>
            <KeyValueList
              items={[
                { key: 'requests', label: s.requests, value: d.confirmation.viewing.requests },
                { key: 'confirmed', label: s.confirmed, value: d.confirmation.viewing.confirmed },
                { key: 'rate', label: s.rate, value: pct(d.confirmation.viewing.rate) },
              ]}
            />
          </Card>
          <Card title={s.responseTime}>
            <KeyValueList
              items={[
                {
                  key: 'median',
                  label: s.median,
                  value: secs(d.confirmation.responseSeconds.median),
                },
                { key: 'p90', label: s.p90, value: secs(d.confirmation.responseSeconds.p90) },
              ]}
            />
          </Card>
          <Card title={s.fulfilment}>
            <KeyValueList
              items={[
                { key: 'dueLines', label: s.dueLines, value: d.fulfilment.dueLines },
                { key: 'onTime', label: s.onTime, value: d.fulfilment.onTime },
                { key: 'rate', label: s.rate, value: pct(d.fulfilment.onTimeRate) },
              ]}
            />
          </Card>
          <Card title={s.navIssues}>
            <KeyValueList
              items={[
                { key: 'lines', label: s.lines, value: d.issues.lines },
                { key: 'navIssues', label: s.navIssues, value: d.issues.issues },
                { key: 'rate', label: s.rate, value: pct(d.issues.issueRate) },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
