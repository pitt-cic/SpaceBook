import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface RequireRoleProps {
  roles: Array<'admin' | 'staff' | 'checkin'>;
  // Name of the route param carrying the site id (e.g. 'site' for /staff/:site/queue).
  // Omit for routes with no site scoping (e.g. /admin/overview).
  siteParam?: string;
  children: ReactNode;
}

/**
 * Client-side mirror of the backend's own site-scoping check
 * (requests_staff/handler.py's require_site_access): 'admin' bypasses every
 * site check, staff-<site>/checkin-<site> only match their own site. This is
 * a UX guard only — the Lambda-side check is the real authorization boundary.
 */
export function RequireRole({ roles, siteParam, children }: RequireRoleProps) {
  const { isAuthenticated, isInitializing, groups } = useAuth();
  const params = useParams();

  if (isInitializing) {
    // Announced politely so a screen reader isn't left on a silent blank page.
    return (
      <main className="min-h-screen flex items-center justify-center text-ink-3">
        <p role="status">Loading…</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const isAdmin = groups.includes('admin');
  const site = siteParam ? params[siteParam] : undefined;

  // With a siteParam, this is the original per-site check (unchanged). With
  // no siteParam (e.g. /dashboard), "staff"/"checkin" instead mean "has any
  // staff-<site>/checkin-<site> group" — a genuinely new case, since no
  // existing route omitted siteParam while asking for those roles.
  const permitted =
    (roles.includes('admin') && isAdmin) ||
    (roles.includes('staff') &&
      (site ? groups.includes(`staff-${site}`) : groups.some((g) => g.startsWith('staff-')))) ||
    (roles.includes('checkin') &&
      (site ? groups.includes(`checkin-${site}`) : groups.some((g) => g.startsWith('checkin-')))) ||
    (isAdmin && (roles.includes('staff') || roles.includes('checkin')));

  if (!permitted) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
