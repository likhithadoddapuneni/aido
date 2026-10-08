import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from './internal/motion.ts';
import { useStrings } from './locale.tsx';
import { Button } from './Button.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * A modal sheet. Screen readers are confined to it while open, the hardware back button and a tap on the
 * backdrop close it, and it slides only when the OS allows motion.
 */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const { color, space, radius } = useTheme();
  const s = useStrings();
  const reduced = useReducedMotion();
  const { height } = useWindowDimensions();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          testID="sheet-backdrop"
          accessible={false}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: color.scrim }}
        />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: color.ivory,
            borderTopStartRadius: radius.xl,
            borderTopEndRadius: radius.xl,
            paddingHorizontal: space[4],
            paddingTop: space[3],
            gap: space[3],
            maxHeight: height * 0.9,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: space[6],
              height: space[1],
              borderRadius: space[1],
              backgroundColor: color.border,
            }}
          />
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: space[3], paddingBottom: space[2] }}
          >
            <Text variant="title" tone="navy">
              {title}
            </Text>
            {children}
          </ScrollView>
          <Button variant="ghost" title={s('close')} onPress={onClose} style={{ marginBottom: space[2] }} />
        </View>
      </View>
    </Modal>
  );
}
