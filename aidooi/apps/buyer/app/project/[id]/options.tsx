import { useLocalSearchParams } from 'expo-router';
import { OptionsScreen } from '../../../src/features/discovery/OptionsScreen.tsx';

export default function Options() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OptionsScreen projectId={id} />;
}
