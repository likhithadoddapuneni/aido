import { useLocalSearchParams } from 'expo-router';
import { CheckoutScreen } from '../../../src/features/transact/CheckoutScreen.tsx';

export default function Checkout() {
  const { id, compositionId } = useLocalSearchParams<{ id: string; compositionId?: string }>();
  return <CheckoutScreen checkoutId={id} compositionId={compositionId} />;
}
