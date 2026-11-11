import { useMutation, useQueryClient } from '@tanstack/react-query';
import { declineCounterProposal } from '../api/requestsRequestor';
import { useRequestorAuth } from './useRequestorAuth';

export function useDeclineCounterProposal() {
  const { getIdToken } = useRequestorAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => declineCounterProposal(id, await getIdToken()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myRequests'] }),
  });
}
