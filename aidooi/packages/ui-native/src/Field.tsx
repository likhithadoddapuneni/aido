import { forwardRef, useId } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { fontFamily } from './internal/fonts.ts';
import { useLocale } from './locale.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  /** When set the field is in error and the message is announced to screen readers. */
  error?: string | undefined;
}

/** A labelled input. The label is the accessible name; hint and error are read with it. */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, accessibilityHint, ...input },
  ref,
) {
  const { color, space, radius, touchTarget, fontSize } = useTheme();
  const { locale, rtl } = useLocale();
  const id = useId();
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="label" nativeID={`${id}-label`}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint ?? accessibilityHint}
        placeholderTextColor={color.text3}
        allowFontScaling
        maxFontSizeMultiplier={1.6}
        style={{
          minHeight: touchTarget,
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: error ? color.err : color.border,
          backgroundColor: color.white,
          color: color.text,
          fontFamily: fontFamily('ui', locale),
          fontSize: fontSize.body,
          textAlign: 'auto',
          writingDirection: rtl ? 'rtl' : 'ltr',
        }}
        {...input}
      />
      {error ? (
        <Text
          variant="caption"
          tone="error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
