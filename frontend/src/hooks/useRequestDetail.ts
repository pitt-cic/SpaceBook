import { useQuery } from '@tanstack/react-query';
import { getRequest } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useRequestDetail(id: string | null, site?: string) {
  const { idToken, getIdToken } = useAuth();
  return useQuery({
    queryKey: ['requestDetail', id, site],
    queryFn: async () => getRequest(id as string, await getIdToken(), site),
    enabled: Boolean(id) && Boolean(idToken),
  });
}
