import { useLocalSearchParams } from 'expo-router';
import { ViewingNewScreen } from '../../src/features/transact/ViewingNewScreen.tsx';

export default function ViewingNew() {
  const { compositionId } = useLocalSearchParams<{ compositionId: string }>();
  return <ViewingNewScreen compositionId={compositionId} />;
}
