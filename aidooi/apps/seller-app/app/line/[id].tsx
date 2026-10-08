import { useLocalSearchParams } from 'expo-router';
import { LineScreen } from '../../src/screens/LineScreen.tsx';

export default function LineRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LineScreen id={String(id)} />;
}
