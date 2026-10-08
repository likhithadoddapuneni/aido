import type { ReactNode } from 'react';
import { BottomSheet, Button, Text, useT, useTheme } from '@aidooi/ui-native';
import { View } from 'react-native';
import { catalogue } from '../i18n/index.ts';

/**
 * A confirmation that says what will happen. Destructive confirmations use the destructive button, and the
 * confirm action is disabled while offline or busy (the Button itself ignores taps until the call settles).
 */
export function ConfirmSheet(props: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const t = useT(catalogue);
  const { space } = useTheme();
  return (
    <BottomSheet visible={props.visible} onClose={props.onClose} title={props.title}>
      <View style={{ gap: space[3] }}>
        <Text>{props.body}</Text>
        {props.children}
        <Button
          title={props.confirmLabel}
          variant={props.destructive ? 'destructive' : 'primary'}
          disabled={props.disabled ?? false}
          onPress={props.onConfirm}
        />
        <Button title={t('common.cancel')} variant="ghost" onPress={props.onClose} />
      </View>
    </BottomSheet>
  );
}
