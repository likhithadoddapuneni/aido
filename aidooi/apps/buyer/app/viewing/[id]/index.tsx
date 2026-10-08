import { useLocalSearchParams } from 'expo-router';
import { ViewingScreen } from '../../../src/features/transact/ViewingScreen.tsx';

export default function Viewing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ViewingScreen viewingId={id} />;
}
