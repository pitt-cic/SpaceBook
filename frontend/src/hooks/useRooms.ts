import { useQuery } from '@tanstack/react-query';
import { listRooms } from '../api/rooms';

export function useRooms(site: string | undefined) {
  return useQuery({
    queryKey: ['rooms', site],
    queryFn: () => listRooms(site!),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(site),
  });
}
