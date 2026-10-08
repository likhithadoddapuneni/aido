import { useLocalSearchParams } from 'expo-router';
import { PayScreen } from '../../../src/features/transact/PayScreen.tsx';

export default function Pay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PayScreen checkoutId={id} />;
}
