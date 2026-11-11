import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rejectCancellation } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useRejectCancellation() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, site }: { id: string; site?: string }) =>
      rejectCancellation(id, await getIdToken(), site),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
      queryClient.invalidateQueries({ queryKey: ['requestDetail', id] });
    },
  });
}
