import { useLocalSearchParams } from 'expo-router';
import { OrderScreen } from '../../../src/features/transact/OrderScreen.tsx';

export default function Order() {
  const { id, placed } = useLocalSearchParams<{ id: string; placed?: string }>();
  return <OrderScreen orderId={id} placed={placed === '1'} />;
}
