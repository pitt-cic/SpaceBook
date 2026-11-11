import { useMutation, useQueryClient } from '@tanstack/react-query';
import { acceptCounterProposal } from '../api/requestsRequestor';
import { useRequestorAuth } from './useRequestorAuth';

export function useAcceptCounterProposal() {
  const { getIdToken } = useRequestorAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => acceptCounterProposal(id, await getIdToken()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myRequests'] }),
  });
}
