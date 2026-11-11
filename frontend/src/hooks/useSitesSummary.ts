import { useQuery } from '@tanstack/react-query';
import { sitesSummary } from '../api/requestsStaff';
import { useAuth } from './useAuth';

// Scoped to the signed-in account server-side (see api/requestsStaff.ts) —
// enabled for any authenticated staff/admin/checkin account, not just admin.
// Backs both the Dashboard page and StaffLayout's "Your Sites" sidebar list.
export function useSitesSummary() {
  const { idToken, getIdToken } = useAuth();
  return useQuery({
    queryKey: ['sitesSummary'],
    queryFn: async () => sitesSummary(await getIdToken()),
    enabled: Boolean(idToken),
  });
}
