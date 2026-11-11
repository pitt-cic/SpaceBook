import { useMutation, useQueryClient } from '@tanstack/react-query';
import { denyRequest } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useDenyRequest() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, site }: { id: string; reason: string; site?: string }) =>
      denyRequest(id, reason, await getIdToken(), site),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
      queryClient.invalidateQueries({ queryKey: ['requestDetail', id] });
    },
  });
}
