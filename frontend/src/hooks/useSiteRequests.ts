import { useQuery } from '@tanstack/react-query';
import { listSiteRequests, type SiteRequestsFilters } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useSiteRequests(site: string, filters: SiteRequestsFilters) {
  const { idToken, getIdToken } = useAuth();
  return useQuery({
    queryKey: ['siteRequests', site, filters],
    queryFn: async () => listSiteRequests(site, filters, await getIdToken()),
    enabled: Boolean(idToken) && Boolean(site),
  });
}
