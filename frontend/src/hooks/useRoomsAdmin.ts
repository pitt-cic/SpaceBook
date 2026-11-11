import { useQuery } from '@tanstack/react-query';
import { listAllRooms } from '../api/roomsAdmin';
import { useAuth } from './useAuth';

export function useRoomsAdmin(site: string) {
  const { idToken, getIdToken } = useAuth();
  return useQuery({
    queryKey: ['roomsAdmin', site],
    queryFn: async () => listAllRooms(site, await getIdToken()),
    enabled: Boolean(idToken),
  });
}
