import { useQuery } from '@tanstack/react-query';
import { listSites } from '../api/sitesAdmin';

// GET /api/sites is public, so this query needs no auth gate — unlike
// useRoomsAdmin/useStaffRoster, which wait on idToken.
export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: () => listSites(),
  });
}
