import { useMemo } from 'react';
import { useServices } from '../../providers/AppProviders.tsx';
import { transactServices, type TransactServices } from './services.ts';

/** The transaction services for the app's API client, created once per client. */
export function useTransact(): TransactServices {
  const { api } = useServices();
  return useMemo(() => transactServices(api), [api]);
}
