import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSite, type SiteInput } from '../api/sitesAdmin';
import { useAuth } from './useAuth';

export function useCreateSite() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SiteInput) => createSite(input, await getIdToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}
