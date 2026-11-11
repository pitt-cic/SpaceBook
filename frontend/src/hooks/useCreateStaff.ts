import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createStaff } from '../api/staffAdmin';
import { useAuth } from './useAuth';

export function useCreateStaff() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, groups }: { email: string; groups: string[] }) =>
      createStaff(email, groups, await getIdToken()),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['staffRoster'] });
    },
  });
}
