import { useLocalSearchParams } from 'expo-router';
import { CompositionScreen } from '../../../src/features/discovery/CompositionScreen.tsx';

export default function Composition() {
  const { id, projectId } = useLocalSearchParams<{ id: string; projectId?: string }>();
  return <CompositionScreen compositionId={id} projectId={projectId} />;
}
