import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  AppBar,
  Backdrop,
  Chip,
  ErrorView,
  Skeleton,
  Swatch,
  Text,
  useTheme,
  type IconName,
} from '@aidooi/ui-native';
import { useTx } from '../i18n/useTx.ts';

/** A heading with a way back: a round back control, then the title in the display serif. */
export function PageHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      {onBack ? <AppBar onBack={onBack} /> : null}
      <Text variant="display" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text tone="secondary">{subtitle}</Text> : null}
    </View>
  );
}

/** A small section label above a group of content. */
export function SectionTitle({ children }: { children: string }) {
  const { space } = useTheme();
  return (
    <View style={{ paddingTop: space[2] }}>
      <Text variant="h3" accessibilityRole="header">
        {children}
      </Text>
    </View>
  );
}

/** One question with its choices as chips; used wherever the answer is one of a short list. */
export function ChoiceChips({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: readonly { value: string; label: string; icon?: IconName }[];
  value: string | undefined;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {options.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            {...(o.icon ? { icon: o.icon } : {})}
            selected={value === o.value}
            onPress={() => onChange(o.value)}
          />
        ))}
      </View>
      {error ? (
        <Text variant="caption" tone="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A colour family picker: the same tones product art uses, so what you pick is what you will see. */
export function ColourPicker({
  label,
  options,
  value,
  onChange,
  assisted,
  error,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string | undefined;
  onChange: (v: string) => void;
  /** The "let AIDOOi choose" option, shown first as a chip. */
  assisted: { value: string; label: string };
  error?: string | undefined;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space[2] }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label">{label}</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <Chip
          label={assisted.label}
          icon="sparkle"
          selected={value === assisted.value}
          onPress={() => onChange(assisted.value)}
        />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[1] }}>
        {options.map((o) => (
          <Swatch
            key={o.value}
            colour={o.value}
            label={o.label}
            selected={value === o.value}
            onPress={() => onChange(o.value)}
          />
        ))}
      </View>
      {error ? (
        <Text variant="caption" tone="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  const { space } = useTheme();
  const t = useTx();
  return (
    <View
      accessibilityLabel={t('common.loading')}
      accessibilityLiveRegion="polite"
      style={{ gap: space[3] }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={88} />
      ))}
    </View>
  );
}

/** Loading, failed (translated, with a retry) or loaded — so no screen forgets one of the three. */
export function QueryBoundary<T>({
  query,
  children,
  skeleton,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (query.isError) return <ErrorView error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}

/** The first frame: the wordmark on the warm backdrop, shown until fonts and the stored session are ready. */
export function BrandSplash() {
  const { space, color } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color.linen,
      }}
    >
      <Backdrop variant="hero" />
      <View style={{ alignItems: 'center', gap: space[2] }}>
        <Text variant="hero" tone="navy" accessibilityRole="header">
          AiDOOi
        </Text>
        <Skeleton width={space[7]} height={space[1]} />
      </View>
    </View>
  );
}
