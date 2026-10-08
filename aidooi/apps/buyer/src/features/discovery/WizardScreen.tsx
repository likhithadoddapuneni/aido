import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Card,
  ErrorView,
  Field,
  Icon,
  RoomScene,
  Screen,
  StepBar,
  StickyBar,
  SegmentedControl,
  Text,
  useStrings,
  useTheme,
} from '@aidooi/ui-native';
import { ChoiceChips, ColourPicker, PageHeader } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import { PRODUCT_TYPES } from '../../projects/productTypes.ts';
import {
  BED_SIZES,
  COLOUR_OPTIONS,
  SLEEPING_SETUPS,
  STEP_FIELDS,
  STYLE_OPTIONS,
  TIER_NAMES,
  finalInput,
  isMultiRoom,
  parseNumber,
  validateStep,
  wizardSteps,
  type Draft,
  type DraftKey,
  type FieldErrors,
  type PathId,
} from '../../projects/wizard.ts';

const NUMERIC: readonly DraftKey[] = [
  'lengthM',
  'widthM',
  'capacity',
  'users',
  'totalAreaM2',
  'bedrooms',
  'livingAreaM2',
  'diningCapacity',
  'floors',
  'totalBudgetAed',
];
const HINTED: readonly DraftKey[] = ['lengthM', 'livingAreaM2', 'diningCapacity', 'totalBudgetAed'];
const MAX_BEDROOMS = 12;

/**
 * One wizard for every path: it asks only the questions that path needs (lean input, AID-SPC), checks
 * each step with the same schema the server uses, and never asks the buyer for a size class — the
 * server derives it. Nothing is created until the last step.
 */
export function WizardScreen({ pathId }: { pathId: PathId }) {
  const t = useTx();
  const router = useRouter();
  const { services } = useServices();
  const { space, radius, color } = useTheme();
  const s = useStrings();
  const width = useWindowDimensions().width;
  const steps = wizardSteps(pathId);
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    style: 'assisted',
    colour: 'assisted',
    tier: 'Standard',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const step = steps[stepIndex] as (typeof steps)[number];
  const last = stepIndex === steps.length - 1;

  const create = useMutation({
    mutationFn: async () => {
      const built = finalInput(pathId, draft);
      if (!built.ok) throw new Error('invalid');
      return services.createProject(built.input);
    },
    onSuccess: (project) => {
      // Rooms pick their tier next, against the real ranges; whole properties and single products already did.
      const goBudget = !isMultiRoom(pathId) && pathId !== 'individualProduct';
      router.replace(`/project/${project.id}/${goBudget ? 'budget' : 'options'}` as never);
    },
  });

  const set = <K extends DraftKey>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };
  const err = (key: DraftKey) => (errors[key] ? t(`error.${errors[key]}` as never) : undefined);

  const next = async () => {
    const problems = validateStep(pathId, draft, step);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      return;
    }
    if (last) await create.mutateAsync().catch(() => undefined);
    else setStepIndex((i) => i + 1);
  };

  const numeric = (key: DraftKey) => (
    <Field
      key={key}
      label={t(`field.${key}` as never)}
      value={(draft[key] as string | undefined) ?? ''}
      onChangeText={(v) => set(key, v as never)}
      keyboardType="decimal-pad"
      error={err(key)}
      {...(HINTED.includes(key) ? { hint: t(`hint.${key}` as never) } : {})}
    />
  );

  const bedrooms = Math.min(
    MAX_BEDROOMS,
    Math.max(0, Math.trunc(parseNumber(draft.bedrooms) || 0)),
  );

  const spaceFields = () =>
    STEP_FIELDS.space(pathId).map((key) => {
      if (NUMERIC.includes(key)) return numeric(key);
      if (key === 'bedSize' || key === 'sleepingSetup') {
        const options = key === 'bedSize' ? BED_SIZES : SLEEPING_SETUPS;
        return (
          <ChoiceChips
            key={key}
            label={t(`field.${key}` as never)}
            options={options.map((o) => ({
              value: o,
              label: t(keyFor(key === 'bedSize' ? 'bed' : 'setup', o)),
            }))}
            value={draft[key]}
            onChange={(v) => set(key, v)}
            error={err(key)}
          />
        );
      }
      if (key === 'office' || key === 'bedroomConsistency') {
        return (
          <View key={key} style={{ gap: space[2] }}>
            <Text variant="label">{t(`field.${key}` as never)}</Text>
            <SegmentedControl
              accessibilityLabel={t(`field.${key}` as never)}
              options={[
                { value: 'no', label: t('common.no') },
                { value: 'yes', label: t('common.yes') },
              ]}
              value={draft[key] ? 'yes' : 'no'}
              onChange={(v) => set(key, (v === 'yes') as never)}
            />
          </View>
        );
      }
      if (key === 'bedroomAreasM2') {
        // One card per bedroom: its size and bed size together, master first. Both are optional.
        return (
          <View key={key} style={{ gap: space[3] }}>
            {Array.from({ length: bedrooms }, (_, i) => (
              <Card
                key={i}
                accessibilityLabel={t(i === 0 ? 'bedroom.master' : 'bedroom.n', { n: i + 1 })}
                style={{ gap: space[2] }}
              >
                <Text variant="h3">
                  {t(i === 0 ? 'bedroom.master' : 'bedroom.n', { n: i + 1 })}
                </Text>
                <Field
                  label={t('field.bedroomArea')}
                  hint={t('hint.bedroomArea')}
                  value={draft.bedroomAreasM2?.[i] ?? ''}
                  keyboardType="decimal-pad"
                  onChangeText={(v) => {
                    const list = [...(draft.bedroomAreasM2 ?? [])];
                    while (list.length <= i) list.push('');
                    list[i] = v;
                    set('bedroomAreasM2', list);
                  }}
                  error={i === 0 ? err('bedroomAreasM2') : undefined}
                />
                <ChoiceChips
                  label={t('field.bedSize')}
                  options={BED_SIZES.map((o) => ({ value: o, label: t(keyFor('bed', o)) }))}
                  value={draft.bedSizes?.[i]}
                  onChange={(v) => {
                    const list = [...(draft.bedSizes ?? [])];
                    while (list.length <= i) list.push('');
                    list[i] = v;
                    set('bedSizes', list);
                  }}
                  error={i === 0 ? err('bedSizes') : undefined}
                />
              </Card>
            ))}
          </View>
        );
      }
      if (key === 'productType') {
        return (
          <ChoiceChips
            key={key}
            label={t('field.productType')}
            options={PRODUCT_TYPES.map((p) => ({
              value: p.type,
              label: t(keyFor('productType', p.type)),
            }))}
            value={draft.productType}
            onChange={(v) =>
              setDraft((d) => {
                const next: Draft = { ...d, productType: v };
                delete next.branch; // the branch belongs to the type that was just replaced
                return next;
              })
            }
            error={err('productType')}
          />
        );
      }
      if (key === 'branch') {
        const branches = PRODUCT_TYPES.find((p) => p.type === draft.productType)?.branches;
        if (!branches) return null;
        return (
          <ChoiceChips
            key={key}
            label={t(`branch.${draft.productType}` as never)}
            options={branches.map((b) => ({
              value: b,
              label: /^\d+$/.test(b)
                ? t(`branchValue.${draft.productType}` as never, { value: b })
                : t(`branchSize.${b}` as never),
            }))}
            value={draft.branch}
            onChange={(v) => set('branch', v)}
          />
        );
      }
      return null; // bedSizes: rendered with the bedroom cards
    });

  const tasteFields = () => (
    <>
      <ChoiceChips
        label={t('field.style')}
        options={[
          { value: 'assisted', label: t('assisted'), icon: 'sparkle' as const },
          ...STYLE_OPTIONS.map((o) => ({ value: o, label: t(keyFor('style', o)) })),
        ]}
        value={draft.style}
        onChange={(v) => set('style', v)}
        error={err('style')}
      />
      <ColourPicker
        label={t('field.colour')}
        assisted={{ value: 'assisted', label: t('assisted') }}
        options={COLOUR_OPTIONS.map((o) => ({ value: o, label: t(keyFor('colour', o)) }))}
        value={draft.colour}
        onChange={(v) => set('colour', v)}
        error={err('colour')}
      />
    </>
  );

  const budgetFields = () => (
    <>
      <ChoiceChips
        label={t('field.tier')}
        options={TIER_NAMES.map((o) => ({ value: o, label: t(keyFor('tier', o)) }))}
        value={draft.tier}
        onChange={(v) => set('tier', v)}
        error={err('tier')}
      />
      {isMultiRoom(pathId) ? numeric('totalBudgetAed') : null}
    </>
  );

  const area = (parseNumber(draft.lengthM) ?? 0) * (parseNumber(draft.widthM) ?? 0);

  const areaLabel =
    step === 'space' && area > 0 && Number.isFinite(area)
      ? t('wizard.area', { area: area.toFixed(1) })
      : null;

  return (
    <Screen
      footer={
        <StickyBar>
          {create.isError && create.error instanceof Error && create.error.message !== 'invalid' ? (
            <ErrorView error={create.error} />
          ) : null}
          <Button
            title={last ? t('wizard.create') : t('common.next')}
            icon={last ? 'sparkle' : undefined}
            loading={create.isPending}
            onPress={next}
          />
        </StickyBar>
      }
    >
      <PageHeader
        title={t(`path.${pathId}.title` as never)}
        subtitle={t(`wizard.${step}` as never)}
        onBack={() => (stepIndex === 0 ? router.back() : setStepIndex((i) => i - 1))}
      />
      <StepBar
        step={stepIndex + 1}
        of={steps.length}
        caption={s('stepOf', { current: stepIndex + 1, total: steps.length })}
      />
      <View
        style={{
          height: Math.round((width - space[3] * 2) * 0.56),
          borderRadius: radius.xl,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: color.borderSoft,
        }}
      >
        <RoomScene
          kind={pathId}
          width={width - space[3] * 2}
          height={Math.round((width - space[3] * 2) * 0.56)}
        />
        {areaLabel ? (
          <View
            style={{
              position: 'absolute',
              end: space[2],
              top: space[2],
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[1],
              backgroundColor: color.glass,
              borderRadius: radius.pill,
              paddingHorizontal: space[2],
              paddingVertical: space[1],
            }}
          >
            <Icon name="ruler" size={16} />
            <Text variant="caption" tone="navy">
              {areaLabel}
            </Text>
          </View>
        ) : null}
      </View>
      {step === 'space' ? spaceFields() : step === 'taste' ? tasteFields() : budgetFields()}
    </Screen>
  );
}
