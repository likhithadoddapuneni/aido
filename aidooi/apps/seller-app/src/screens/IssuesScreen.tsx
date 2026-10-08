import { useState } from 'react';
import { View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Screen,
  Text,
  useLocale,
  useT,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { useOnline } from '../net/online.ts';
import { useAuth } from '../session/auth.tsx';
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { QueryState } from '../ui/Query.tsx';
import { LINES_KEY } from './useLines.ts';

const ISSUES_KEY = ['issues'] as const;

export function IssuesScreen() {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const { space } = useTheme();
  const toast = useToast();
  const online = useOnline();
  const { data } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const q = useInfiniteQuery({
    queryKey: [...ISSUES_KEY, 'open'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      // Open and in-progress are both "still needs us".
      const [open, handling] = await Promise.all([
        data.issues({ state: 'Open', ...(pageParam ? { cursor: pageParam } : {}) }),
        pageParam
          ? Promise.resolve({ items: [], nextCursor: null })
          : data.issues({ state: 'Partner Handling' }),
      ]);
      return { items: [...open.items, ...handling.items], nextCursor: open.nextCursor };
    },
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const respond = useMutation({
    mutationFn: (a: { id: string; action: 'PartnerHandling' | 'Resolved' }) =>
      data.respondIssue(a.id, { note: note.trim(), action: a.action }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ISSUES_KEY });
      void qc.invalidateQueries({ queryKey: LINES_KEY });
    },
  });

  const send = async (action: 'PartnerHandling' | 'Resolved') => {
    if (!target) return;
    try {
      await respond.mutateAsync({ id: target, action });
      setTarget(null);
      setNote('');
      toast.show({ message: t('issues.sent'), tone: 'ok' });
    } catch (e) {
      toast.show({ message: messageFor(e, locale), tone: 'error' });
    }
  };

  return (
    <Screen>
      <Text variant="h1">{t('issues.title')}</Text>
      <OfflineBanner />
      <QueryState loading={q.isPending} error={q.error} onRetry={() => q.refetch()}>
        {items.length === 0 ? (
          <EmptyState title={t('issues.empty')} />
        ) : (
          <View style={{ gap: space[3] }}>
            {items.map((i) => (
              <Card key={i.id}>
                <Text variant="h3">{i.productName}</Text>
                <Badge label={i.flag} tone="warn" />
                {i.note ? (
                  <Text onSurface tone="secondary">
                    {i.note}
                  </Text>
                ) : null}
                <Button
                  title={t('issues.respond')}
                  disabled={!online}
                  onPress={() => setTarget(i.id)}
                />
              </Card>
            ))}
          </View>
        )}
      </QueryState>
      <ConfirmSheet
        visible={target !== null}
        title={t('issues.respond')}
        body=""
        confirmLabel={t('issues.resolved')}
        disabled={!online || note.trim().length < 1}
        onConfirm={() => send('Resolved')}
        onClose={() => setTarget(null)}
      >
        <Field label={t('issues.note')} value={note} onChangeText={setNote} multiline />
        <Button
          title={t('issues.handling')}
          variant="secondary"
          disabled={!online || note.trim().length < 1}
          onPress={() => send('PartnerHandling')}
        />
      </ConfirmSheet>
    </Screen>
  );
}
