import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelRequest } from '../api/requestsRequestor';
import { useRequestorAuth } from './useRequestorAuth';

export function useCancelRequest() {
  const { getIdToken } = useRequestorAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => cancelRequest(id, await getIdToken()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myRequests'] }),
  });
}
