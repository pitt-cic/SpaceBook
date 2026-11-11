export interface Site {
  id: string;
  label: string;
  color: string;
}

// Static label/color fallback for SiteBadge, AccountSettingsPage, and
// AdminStaffPage when no live label (from GET /api/sites) is passed. The live
// Sites table is the source of truth for which sites exist.
export const SITES: Record<string, Site> = {
  homewood: { id: 'homewood', label: 'Homewood CEC', color: '#003594' },
  hill_district: { id: 'hill_district', label: 'Hill District CEC', color: '#1D9E75' },
  hazelwood: { id: 'hazelwood', label: 'Hazelwood CEC', color: '#7F77DD' },
};

export function siteLabel(siteId: string): string {
  return SITES[siteId]?.label ?? siteId;
}

export function siteColor(siteId: string): string {
  return SITES[siteId]?.color ?? '#6B7280';
}
