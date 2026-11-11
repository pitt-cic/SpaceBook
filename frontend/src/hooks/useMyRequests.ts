import { useQuery } from '@tanstack/react-query';
import { getMyRequests } from '../api/requestsRequestor';
import { useRequestorAuth } from './useRequestorAuth';

export function useMyRequests() {
  const { idToken, getIdToken, isAuthenticated } = useRequestorAuth();
  return useQuery({
    queryKey: ['myRequests'],
    queryFn: async () => getMyRequests(await getIdToken()),
    enabled: isAuthenticated && Boolean(idToken),
  });
}
