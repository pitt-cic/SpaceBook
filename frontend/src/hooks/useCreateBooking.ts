import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createBooking } from '../api/requestsStaff';
import type { SubmitRequestInput } from '../types/api';
import { useAuth } from './useAuth';

export function useCreateBooking() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ site, input }: { site: string; input: SubmitRequestInput }) =>
      createBooking(site, input, await getIdToken()),
    onSuccess: (_data, { site }) => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
      queryClient.invalidateQueries({ queryKey: ['availability', site] });
      queryClient.invalidateQueries({ queryKey: ['sitesSummary'] });
    },
  });
}
