import { useLocalSearchParams } from 'expo-router';
import { ReplaceScreen } from '../../../../src/features/discovery/ReplaceScreen.tsx';

export default function Replace() {
  const { id, slot } = useLocalSearchParams<{ id: string; slot: string }>();
  return <ReplaceScreen compositionId={id} slotKey={slot} />;
}
