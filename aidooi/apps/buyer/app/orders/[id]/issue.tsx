import { useLocalSearchParams } from 'expo-router';
import { IssueScreen } from '../../../src/features/transact/IssueScreen.tsx';

export default function Issue() {
  const { id, lineId } = useLocalSearchParams<{ id: string; lineId: string }>();
  return <IssueScreen orderId={id} lineId={lineId} />;
}
