import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Card,
  ErrorView,
  Field,
  Screen,
  Text,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { IssueFlagSchema } from '@aidooi/contracts';
import { PageHeader } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { useTransact } from './useTransact.ts';

export const ISSUE_FLAGS = IssueFlagSchema.options;
export const NOTE_MAX = 1000;

/** Tell us what is wrong with an item. One report per problem; the seller and AIDOOi see it, and the payout is held while it is open. */
export function IssueScreen({ orderId, lineId }: { orderId: string; lineId: string }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const tx = useTransact();
  const [flag, setFlag] = useState<(typeof ISSUE_FLAGS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);

  const raise = useMutation({
    mutationFn: () =>
      tx.raiseIssue(orderId, lineId, {
        flag: flag as string,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast.show({ message: t('issue.sent'), tone: 'ok' });
      router.back();
    },
  });

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader
          title={t('issue.title')}
          subtitle={t('issue.subtitle')}
          onBack={() => router.back()}
        />
        <View
          style={{ gap: space[2] }}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('issue.what')}
        >
          {ISSUE_FLAGS.map((f) => (
            <Card key={f}>
              <Button
                variant={flag === f ? 'primary' : 'secondary'}
                title={t(keyFor('issueFlag', f))}
                accessibilityState={{ selected: flag === f }}
                onPress={() => {
                  setFlag(f);
                  setMissing(false);
                }}
              />
              <Text variant="caption" tone="secondary">
                {t(keyFor('issueHelp', f))}
              </Text>
            </Card>
          ))}
        </View>
        {missing ? <Banner tone="warn" message={t('issue.pick')} /> : null}
        <Field
          label={t('issue.note')}
          value={note}
          onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
          multiline
          hint={t('issue.noteHint', { n: NOTE_MAX - note.length })}
        />
        {raise.isError ? <ErrorView error={raise.error} /> : null}
        <Button
          title={t('issue.send')}
          loading={raise.isPending}
          onPress={() => {
            if (!flag) {
              setMissing(true);
              return;
            }
            return raise.mutateAsync().catch(() => undefined);
          }}
        />
      </View>
    </Screen>
  );
}
