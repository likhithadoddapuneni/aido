import { View } from 'react-native';
import { Button } from './Button.tsx';
import { useStrings } from './locale.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function QuantityStepper({ value, onChange, min = 1, max = 20 }: QuantityStepperProps) {
  const { space } = useTheme();
  const s = useStrings();
  return (
    <View
      accessible={false}
      accessibilityRole="adjustable"
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
    >
      <Button
        variant="secondary"
        title="−"
        accessibilityLabel={s('decrease')}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
      />
      <Text
        variant="price"
        accessibilityLabel={`${s('quantity')} ${value}`}
        style={{ minWidth: space[5], textAlign: 'center' }}
      >
        {value}
      </Text>
      <Button
        variant="secondary"
        title="+"
        accessibilityLabel={s('increase')}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
      />
    </View>
  );
}
