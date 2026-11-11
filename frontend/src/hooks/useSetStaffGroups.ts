import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setStaffGroups } from '../api/staffAdmin';
import { useAuth } from './useAuth';

export function useSetStaffGroups() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ username, groups }: { username: string; groups: string[] }) =>
      setStaffGroups(username, groups, await getIdToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staffRoster'] });
    },
  });
}
