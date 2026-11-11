import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRoom, type RoomInput } from '../api/roomsAdmin';
import { useAuth } from './useAuth';

export function useCreateRoom() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ site, input }: { site: string; input: RoomInput }) =>
      createRoom(site, input, await getIdToken()),
    onSuccess: (_data, { site }) => {
      queryClient.invalidateQueries({ queryKey: ['rooms', site] });
      queryClient.invalidateQueries({ queryKey: ['roomsAdmin', site] });
    },
  });
}
