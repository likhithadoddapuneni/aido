import { useLocalSearchParams } from 'expo-router';
import { CheckoutStartScreen } from '../../src/features/transact/CheckoutStartScreen.tsx';

export default function CheckoutStart() {
  const { compositionId, viewingId } = useLocalSearchParams<{
    compositionId: string;
    viewingId?: string;
  }>();
  return <CheckoutStartScreen compositionId={compositionId} viewingId={viewingId} />;
}
