import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resendInvite } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useResendInvite() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, site }: { id: string; site?: string }) => resendInvite(id, await getIdToken(), site),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['requestDetail', id] });
    },
  });
}
