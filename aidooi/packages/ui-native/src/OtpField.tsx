import { useRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { fontFamily } from './internal/fonts.ts';
import { useLocale, useStrings } from './locale.tsx';
import { sanitiseOtp } from './phone.ts';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface OtpFieldProps {
  value: string;
  onChange: (code: string) => void;
  /** Fired once, when the last digit arrives (typing, paste or SMS autofill). */
  onComplete?: (code: string) => void;
  length?: number;
  error?: boolean;
  autoFocus?: boolean;
}

/**
 * One hidden input owns the text, so paste, SMS autofill and the keyboard's own one-time-code suggestion
 * all work; the boxes merely display it. Digits always read left-to-right, even in Arabic.
 */
export function OtpField({
  value,
  onChange,
  onComplete,
  length = 6,
  error = false,
  autoFocus = false,
}: OtpFieldProps) {
  const { color, space, radius, touchTarget, fontSize } = useTheme();
  const { locale } = useLocale();
  const s = useStrings();
  const input = useRef<TextInput>(null);

  const change = (raw: string) => {
    const next = sanitiseOtp(raw, length);
    onChange(next);
    if (next.length === length && value.length < length) onComplete?.(next);
  };

  return (
    <View
      accessible
      accessibilityLabel={`${s('codeLabel')}. ${s('codeProgress', { count: value.length, total: length })}`}
      accessibilityLiveRegion="polite"
      style={{ direction: 'ltr' }}
    >
      <Pressable
        accessible={false}
        onPress={() => input.current?.focus()}
        style={{ flexDirection: 'row', gap: space[2], justifyContent: 'center' }}
      >
        {Array.from({ length }, (_, i) => {
          const active = i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              testID={`otp-box-${i}`}
              style={{
                width: touchTarget,
                height: touchTarget + space[2],
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: error ? color.err : active ? color.navy : color.border,
                backgroundColor: color.white,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                variant="h2"
                style={{ fontFamily: fontFamily('ui', locale), fontSize: fontSize.h3 }}
              >
                {value[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        testID="otp-input"
        value={value}
        onChangeText={change}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus={autoFocus}
        caretHidden
        accessibilityLabel={s('codeLabel')}
        style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%' }}
      />
    </View>
  );
}
