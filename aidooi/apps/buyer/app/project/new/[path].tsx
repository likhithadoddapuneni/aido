import { Redirect, useLocalSearchParams } from 'expo-router';
import { WizardScreen } from '../../../src/features/discovery/WizardScreen.tsx';
import { isPathId } from '../../../src/projects/wizard.ts';

export default function NewProject() {
  const { path } = useLocalSearchParams<{ path: string }>();
  if (!path || !isPathId(path)) return <Redirect href={'/(tabs)/home' as never} />;
  return <WizardScreen key={path} pathId={path} />;
}
