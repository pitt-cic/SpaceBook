import { useMutation, useQueryClient } from '@tanstack/react-query';
import { modifyRequest, type ModifyRequestInput } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useModifyRequest() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, proposal, site }: { id: string; proposal: ModifyRequestInput; site?: string }) =>
      modifyRequest(id, proposal, await getIdToken(), site),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
      queryClient.invalidateQueries({ queryKey: ['requestDetail', id] });
    },
  });
}
