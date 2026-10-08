import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Platform, Pressable, View } from 'react-native';
import { badgeColours, type BadgeTone } from './Badge.tsx';
import { useStrings } from './locale.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface ToastInput {
  message: string;
  tone?: Extract<BadgeTone, 'ok' | 'warn' | 'error' | 'info'>;
  /** How long it stays. Errors default to longer: people need time to read what went wrong. */
  durationMs?: number;
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ show: (t: ToastInput) => void }>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);

/** Shows one toast at a time (a new one replaces the current), announces it, and dismisses on tap or timeout. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { color, space, radius } = useTheme();
  const s = useStrings();
  const [toast, setToast] = useState<ToastItem | null>(null);
  const seq = useRef(0);

  const show = useCallback((t: ToastInput) => {
    seq.current += 1;
    setToast({ ...t, id: seq.current });
    // iOS does not read live regions on its own.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(t.message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.durationMs ?? (toast.tone === 'error' ? 6000 : 3500);
    const timer = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), ms);
    return () => clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => ({ show }), [show]);
  const c = badgeColours(color)[toast?.tone ?? 'info'];
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: space[6],
            insetInlineStart: space[3],
            insetInlineEnd: space[3],
          }}
        >
          <Pressable
            testID="toast"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={toast.message}
            accessibilityHint={s('dismiss')}
            onPress={() => setToast(null)}
            style={{
              padding: space[3],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.bg,
            }}
          >
            <Text tone={c.text}>{toast.message}</Text>
          </Pressable>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}
