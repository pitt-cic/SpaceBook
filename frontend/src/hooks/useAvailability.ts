import { useQuery } from '@tanstack/react-query';
import { getAvailability } from '../api/requestsPublic';

export function useAvailability(site: string, date: string | null) {
  return useQuery({
    queryKey: ['availability', site, date],
    queryFn: () => getAvailability(site, date as string),
    enabled: Boolean(date),
  });
}
