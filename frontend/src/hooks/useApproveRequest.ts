import { useMutation, useQueryClient } from '@tanstack/react-query';
import { approveRequest } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useApproveRequest() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, site, room }: { id: string; site?: string; room?: string }) =>
      approveRequest(id, await getIdToken(), site, room),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
      queryClient.invalidateQueries({ queryKey: ['requestDetail', id] });
    },
  });
}
