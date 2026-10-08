import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADDRESS_EMIRATES, AddressInputSchema } from '@aidooi/contracts';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorView,
  Field,
  ListRow,
  Screen,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import { ChoiceChips, ListSkeleton, PageHeader } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { GatedError, Section } from './parts.tsx';
import { useTransact } from './useTransact.ts';
import { type Address } from './services.ts';

interface Draft {
  id: string | null;
  label: string;
  line1: string;
  line2: string;
  area: string;
  emirate: string;
  isDefault: boolean;
}
const blank: Draft = {
  id: null,
  label: '',
  line1: '',
  line2: '',
  area: '',
  emirate: '',
  isDefault: false,
};

/** Saved delivery addresses: list, add, edit, delete (deleting asks first). */
export function AddressesScreen() {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const qc = useQueryClient();
  const tx = useTransact();
  const list = useQuery({ queryKey: ['addresses'], queryFn: () => tx.listAddresses() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] });
  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const parsed = AddressInputSchema.safeParse({
        ...(d.label.trim() ? { label: d.label.trim() } : {}),
        line1: d.line1.trim(),
        ...(d.line2.trim() ? { line2: d.line2.trim() } : {}),
        ...(d.area.trim() ? { area: d.area.trim() } : {}),
        emirate: d.emirate,
        isDefault: d.isDefault,
      });
      if (!parsed.success) {
        setBad(new Set(parsed.error.issues.map((i) => String(i.path[0]))));
        return false;
      }
      setBad(new Set());
      if (d.id) await tx.updateAddress(d.id, parsed.data as never);
      else await tx.createAddress(parsed.data as never);
      return true;
    },
    onSuccess: async (ok) => {
      if (!ok) return;
      setDraft(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => tx.deleteAddress(id),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
  });

  const edit = (a: Address) =>
    setDraft({
      id: a.id,
      label: a.label ?? '',
      line1: a.line1,
      line2: a.line2 ?? '',
      area: a.area ?? '',
      emirate: a.emirate,
      isDefault: a.isDefault,
    });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const err = (k: string) => (bad.has(k) ? t('error.invalid') : undefined);

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('addresses.title')} onBack={() => router.back()} />
        {list.isPending ? <ListSkeleton /> : null}
        {list.isError ? (
          <GatedError
            error={list.error}
            resumeHref="/account/addresses"
            onRetry={() => list.refetch()}
          />
        ) : null}
        {list.data && list.data.length === 0 && !draft ? (
          <EmptyState icon="pin" title={t('addresses.empty')} message={t('addresses.emptyHint')} />
        ) : null}
        {list.data?.map((a) => (
          <Card key={a.id}>
            <View style={{ gap: space[2] }}>
              <ListRow
                title={a.label || a.line1}
                subtitle={[a.line1, a.area, a.emirate].filter(Boolean).join(', ')}
                trailing={
                  a.isDefault ? <Badge label={t('addresses.default')} tone="info" /> : undefined
                }
                onPress={() => edit(a)}
                chevron
              />
              {deleting === a.id ? (
                <Button
                  title={t('addresses.deleteConfirm')}
                  variant="destructive"
                  loading={remove.isPending}
                  onPress={() => remove.mutateAsync(a.id).catch(() => undefined)}
                />
              ) : (
                <Button
                  title={t('addresses.delete')}
                  variant="ghost"
                  onPress={() => setDeleting(a.id)}
                />
              )}
            </View>
          </Card>
        ))}
        {remove.isError ? <ErrorView error={remove.error} /> : null}
        {draft ? (
          <Section title={draft.id ? t('addresses.edit') : t('addresses.add')}>
            <Field
              label={t('addresses.label')}
              value={draft.label}
              onChangeText={(v) => set('label', v)}
              hint={t('addresses.labelHint')}
            />
            <Field
              label={t('delivery.line1')}
              value={draft.line1}
              onChangeText={(v) => set('line1', v)}
              error={err('line1')}
            />
            <Field
              label={t('delivery.line2')}
              value={draft.line2}
              onChangeText={(v) => set('line2', v)}
            />
            <Field
              label={t('delivery.area')}
              value={draft.area}
              onChangeText={(v) => set('area', v)}
            />
            <ChoiceChips
              label={t('delivery.emirate')}
              value={draft.emirate || undefined}
              onChange={(v) => set('emirate', v)}
              options={ADDRESS_EMIRATES.map((e) => ({
                value: e,
                label: t(`emirate.${e}` as never),
              }))}
              error={err('emirate')}
            />
            <Chip
              label={t('addresses.makeDefault')}
              selected={draft.isDefault}
              onPress={() => set('isDefault', !draft.isDefault)}
            />
            {save.isError ? <ErrorView error={save.error} /> : null}
            <Button
              title={t('addresses.save')}
              loading={save.isPending}
              onPress={() => save.mutateAsync(draft).catch(() => undefined)}
            />
            <Button
              title={t('common.cancel')}
              variant="ghost"
              onPress={() => (setDraft(null), setBad(new Set()))}
            />
          </Section>
        ) : (
          <Button
            title={t('addresses.add')}
            variant="secondary"
            onPress={() => setDraft({ ...blank })}
          />
        )}
        <Text variant="caption" tone="secondary">
          {t('addresses.note')}
        </Text>
      </View>
    </Screen>
  );
}
