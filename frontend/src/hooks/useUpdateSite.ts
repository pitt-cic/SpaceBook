import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateSite, type UpdateSiteInput } from '../api/sitesAdmin';
import { useAuth } from './useAuth';

export function useUpdateSite() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ site, input }: { site: string; input: UpdateSiteInput }) =>
      updateSite(site, input, await getIdToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}
