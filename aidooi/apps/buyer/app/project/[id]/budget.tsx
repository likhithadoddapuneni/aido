import { useLocalSearchParams } from 'expo-router';
import { BudgetScreen } from '../../../src/features/discovery/BudgetScreen.tsx';

export default function Budget() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BudgetScreen projectId={id} />;
}
