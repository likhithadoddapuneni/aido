import { useLocalSearchParams } from 'expo-router';
import { PassScreen } from '../../../src/features/transact/PassScreen.tsx';

export default function Pass() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PassScreen viewingId={id} />;
}
