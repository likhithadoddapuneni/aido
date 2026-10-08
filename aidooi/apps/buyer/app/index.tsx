import { Redirect } from 'expo-router';
import { useAppState } from '../src/providers/AppProviders.tsx';

export default function Index() {
  const { onboarded } = useAppState();
  return <Redirect href={(onboarded ? '/(tabs)/home' : '/(onboarding)/language') as never} />;
}
