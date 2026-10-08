import { useLocalSearchParams } from 'expo-router';
import { TaskDetailScreen } from '../../src/screens/TaskDetailScreen.tsx';

export default function TaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaskDetailScreen id={String(id)} />;
}
