// Where to land a Pool A (staff/admin) user right after sign-in, based on
// their cognito:groups claim. Mirrors requests_staff/handler.py's own
// group-derived site scoping (admin > staff-<site> > checkin-<site>).
export function destinationForGroups(groups: string[]): string {
  if (groups.includes('admin')) return '/dashboard';

  const staffGroup = groups.find((g) => g.startsWith('staff-'));
  if (staffGroup) return `/staff/${staffGroup.slice('staff-'.length)}/queue`;

  const checkinGroup = groups.find((g) => g.startsWith('checkin-'));
  if (checkinGroup) return `/checkin/${checkinGroup.slice('checkin-'.length)}`;

  return '/login';
}
