import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateRoom, type UpdateRoomInput } from '../api/roomsAdmin';
import { useAuth } from './useAuth';

export function useUpdateRoom() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ site, roomId, input }: { site: string; roomId: string; input: UpdateRoomInput }) =>
      updateRoom(site, roomId, input, await getIdToken()),
    onSuccess: (_data, { site }) => {
      queryClient.invalidateQueries({ queryKey: ['rooms', site] });
      queryClient.invalidateQueries({ queryKey: ['roomsAdmin', site] });
    },
  });
}
