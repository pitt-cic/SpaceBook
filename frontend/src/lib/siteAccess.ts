// What a Pool A account may do at one site, from its cognito:groups claim.
// Mirrors requests_staff/handler.py's require_site_access: admin and
// staff-<site> manage the site; checkin-<site> only runs front-desk check-in.
// UX only (which nav items to show); the Lambda is the real boundary.
export function canManageSite(groups: string[], site: string): boolean {
  return groups.includes('admin') || groups.includes(`staff-${site}`);
}

export function canCheckInAtSite(groups: string[], site: string): boolean {
  return canManageSite(groups, site) || groups.includes(`checkin-${site}`);
}
