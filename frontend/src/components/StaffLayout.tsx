import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AccessibilityFooter } from './a11y/AccessibilityFooter';
import { SkipLink } from './a11y/SkipLink';
import {
  BuildingIcon,
  CalendarIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DashboardIcon,
  IdentificationIcon,
  MapPinIcon,
  MenuIcon,
  SignOutIcon,
  UsersIcon,
} from './icons';
import { SiteBadge } from './ui/SiteBadge';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMenuButton } from '../hooks/useMenuButton';
import { useOperatingSite } from '../hooks/useOperatingSite';
import { useSites } from '../hooks/useSites';
import { canCheckInAtSite, canManageSite } from '../lib/siteAccess';

interface StaffLayoutProps {
  // 'account' has no sidebar nav entry of its own — it's only reachable via
  // the footer's user row — so it never matches a nav item's active check.
  // 'rooms' is the per-site room catalog (AdminRoomsPage), highlighted by the
  // scoped "Manage Rooms" nav item. 'book' is the staff New Booking form.
  activeNav: 'dashboard' | 'calendar' | 'queue' | 'book' | 'checkin' | 'rooms' | 'sites' | 'staff' | 'account';
  // Omit for pages with no single site of their own (Dashboard, Manage
  // Sites, Staff Access) — the header then shows no site badge.
  site?: string;
  siteLabel?: string;
  siteColor?: string;
  title: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}

function navItemClass(active: boolean): string {
  return `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm ${
    active ? 'bg-white text-primary-900 font-medium' : 'text-white/80 hover:bg-white/10'
  }`;
}

function navIconClass(active: boolean): string {
  return `w-4 h-4 shrink-0 ${active ? 'text-primary-600' : ''}`;
}

export function StaffLayout({ activeNav, site, siteLabel, siteColor, title, headerExtra, children }: StaffLayoutProps) {
  const { groups, email } = useAuth();
  const { operatingSite, setOperatingSite, accountSiteIds } = useOperatingSite();
  const { data: sitesData } = useSites();
  const navigate = useNavigate();
  const isAdmin = groups.includes('admin');
  // The scoped nav only offers what this account can do at the current site:
  // staff-<site> gets every tab, checkin-<site> alone gets just Check-In.
  const canManage = Boolean(operatingSite) && canManageSite(groups, operatingSite);
  const canCheckIn = Boolean(operatingSite) && canCheckInAtSite(groups, operatingSite);
  // Both menus follow the APG menu-button pattern (useMenuButton): the
  // standard Gmail/Slack dropdown the captain asked for, operable by keyboard
  // and announced as a menu.
  const userMenu = useMenuButton();
  const siteMenu = useMenuButton();

  // Below the md breakpoint the sidebar is an off-canvas drawer opened from the
  // header's Menu button, so the page reflows to a single column at 320px
  // wide / 400% zoom (WCAG 1.4.10) instead of squeezing beside a fixed sidebar.
  const [navOpen, setNavOpen] = useState(false);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    if (!navOpen) return;
    sidebarRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setNavOpen(false);
      navButtonRef.current?.focus();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navOpen]);

  // Keeps the sidebar's notion of "current site" in sync whenever a
  // site-scoped page (Room Availability/Manage Requests/room CRUD) mounts
  // with a specific `:site` from the URL — deep links keep working, and the
  // "Your Sites" panel always highlights whatever's actually on screen.
  useEffect(() => {
    if (site && site !== operatingSite) setOperatingSite(site);
  }, [site, operatingSite, setOperatingSite]);

  const siteDirectory = sitesData?.sites ?? [];
  const yourSites = accountSiteIds.map(
    (id) => siteDirectory.find((s) => s.id === id) ?? { id, label: id, color: '#6B7280', active: true },
  );
  const currentSite = yourSites.find((s) => s.id === operatingSite);
  const currentSiteLabel = currentSite?.label ?? siteDirectory.find((s) => s.id === operatingSite)?.label ?? operatingSite;
  const currentSiteColor = currentSite?.color ?? siteDirectory.find((s) => s.id === operatingSite)?.color ?? '#6B7280';

  // The site switcher (below) is the single place the active site is chosen;
  // the scoped nav below it acts on `operatingSite`. Switching re-targets Room
  // Availability / Manage Requests / Manage Rooms and follows you if you're
  // already on one of those pages, so the URL and sidebar never disagree.
  // A staff page followed onto a check-in-only site lands on its Check-In.
  function switchSite(newSite: string) {
    setOperatingSite(newSite);
    const staffPage = activeNav === 'calendar' || activeNav === 'queue' || activeNav === 'book';
    if (staffPage && !canManageSite(groups, newSite)) navigate(`/checkin/${newSite}`);
    else if (activeNav === 'calendar') navigate(`/staff/${newSite}/calendar`);
    else if (activeNav === 'queue') navigate(`/staff/${newSite}/queue`);
    else if (activeNav === 'book') navigate(`/staff/${newSite}/book`);
    else if (activeNav === 'rooms') navigate(`/admin/sites/${newSite}/rooms`);
    else if (activeNav === 'checkin') navigate(`/checkin/${newSite}`);
    siteMenu.close(true);
  }

  const initials = email.slice(0, 2).toUpperCase() || '··';
  useDocumentTitle(site ? `${title} · ${siteLabel ?? currentSiteLabel}` : title);

  return (
    <div className="h-screen bg-canvas flex overflow-hidden">
      <SkipLink />
      {navOpen && (
        <div className="fixed inset-0 z-30 bg-ink/30 md:hidden" aria-hidden="true" onClick={() => setNavOpen(false)} />
      )}
      <aside
        id="staff-sidebar"
        ref={sidebarRef}
        aria-label="Sidebar"
        className={`${
          navOpen ? 'flex fixed inset-y-0 left-0 z-40 w-64 shadow-2xl' : 'hidden'
        } md:flex md:static md:w-56 md:shadow-none shrink-0 bg-primary-900 text-white flex-col`}
      >
        <div className="p-4 flex items-center gap-2.5">
          <span
            className="w-7 h-7 rounded-lg bg-accent text-primary-900 font-extrabold flex items-center justify-center text-sm shrink-0"
            aria-hidden="true"
          >
            S
          </span>
          <span className="leading-tight">
            <span className="block font-semibold text-sm">SpaceBook</span>
            <span className="block text-[10px] text-white/70">Space booking</span>
          </span>
        </div>

        {/* Site switcher (UI redesign direction A, Mobbin-referenced:
            Notion/Fibery/ElevenLabs workspace switcher). This is the ONE place
            the active site is named and chosen — it replaces the old "Your
            Sites" list + "Operations — {site}" header, which split the
            current-site signal across two places and made room editing scope
            ambiguous. The scoped nav below acts on this selection. */}
        {/* A non-admin with one site has nothing to switch to, so it's named
            but not a menu. */}
        {operatingSite && yourSites.length === 1 && !isAdmin && (
          <div className="px-2 pt-1">
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/5 border border-white/10">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: currentSiteColor }}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0 leading-tight">
                <span className="block text-sm font-medium text-white truncate">{currentSiteLabel}</span>
                <span className="block text-[10px] text-primary-300">Current site</span>
              </span>
            </div>
          </div>
        )}
        {operatingSite && (yourSites.length > 1 || (isAdmin && yourSites.length > 0)) && (
          <div className="px-2 pt-1 relative" ref={siteMenu.containerRef}>
            <button
              type="button"
              {...siteMenu.buttonProps}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: currentSiteColor }}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0 text-left leading-tight">
                <span className="block text-sm font-medium text-white truncate">{currentSiteLabel}</span>
                <span className="block text-[10px] text-primary-300">Current site</span>
              </span>
              <ChevronDownIcon
                className={`w-3.5 h-3.5 text-white/50 shrink-0 transition-transform ${siteMenu.open ? 'rotate-180' : ''}`}
              />
            </button>

            {siteMenu.open && (
              <div
                {...siteMenu.menuProps}
                className="absolute left-2 right-2 top-full mt-1.5 bg-primary-800 border border-white/10 rounded-lg shadow-lg py-1 z-20"
              >
                {yourSites.map((s) => {
                  const current = s.id === operatingSite;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      tabIndex={-1}
                      onClick={() => switchSite(s.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left focus:bg-white/10 ${
                        current ? 'text-white' : 'text-white/80 hover:bg-white/10'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} aria-hidden="true" />
                      <span className="flex-1 min-w-0 truncate">{s.label}</span>
                      {current && (
                        <span className="text-accent text-xs shrink-0" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
                {isAdmin && (
                  <>
                    <div className="my-1 border-t border-white/10" role="separator" />
                    <Link
                      to="/admin/sites"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => siteMenu.close(false)}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm text-primary-300 hover:bg-white/10 hover:text-white focus:bg-white/10"
                    >
                      <BuildingIcon className="w-4 h-4 shrink-0" />
                      Manage all sites
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <nav aria-label="Main" className="flex flex-col px-2 gap-0.5 flex-1 overflow-y-auto pt-1">
          <Link to="/dashboard" className={navItemClass(activeNav === 'dashboard')} aria-current={activeNav === 'dashboard' ? 'page' : undefined}>
            <DashboardIcon className={navIconClass(activeNav === 'dashboard')} />
            Dashboard
          </Link>
          {canManage && (
            <>
              <Link to={`/staff/${operatingSite}/calendar`} className={navItemClass(activeNav === 'calendar')} aria-current={activeNav === 'calendar' ? 'page' : undefined}>
                <CalendarIcon className={navIconClass(activeNav === 'calendar')} />
                Room Availability
              </Link>
              <Link to={`/staff/${operatingSite}/queue`} className={navItemClass(activeNav === 'queue')} aria-current={activeNav === 'queue' ? 'page' : undefined}>
                <CheckCircleIcon className={navIconClass(activeNav === 'queue')} />
                Manage Requests
              </Link>
              <Link to={`/staff/${operatingSite}/book`} className={navItemClass(activeNav === 'book')} aria-current={activeNav === 'book' ? 'page' : undefined}>
                <CalendarPlusIcon className={navIconClass(activeNav === 'book')} />
                New Booking
              </Link>
            </>
          )}
          {canCheckIn && (
            <Link to={`/checkin/${operatingSite}`} className={navItemClass(activeNav === 'checkin')} aria-current={activeNav === 'checkin' ? 'page' : undefined}>
              <IdentificationIcon className={navIconClass(activeNav === 'checkin')} />
              Check-In
            </Link>
          )}
          {isAdmin && (
            <Link to={`/admin/sites/${operatingSite}/rooms`} className={navItemClass(activeNav === 'rooms')} aria-current={activeNav === 'rooms' ? 'page' : undefined}>
              <MapPinIcon className={navIconClass(activeNav === 'rooms')} />
              Manage Rooms
            </Link>
          )}

          {isAdmin && (
            <>
              <h2 id="admin-nav-heading" className="text-[10px] font-semibold uppercase tracking-wide text-primary-300 px-2.5 pt-3 pb-1">
                Admin · all sites
              </h2>
              <Link to="/admin/sites" className={navItemClass(activeNav === 'sites')} aria-current={activeNav === 'sites' ? 'page' : undefined}>
                <BuildingIcon className={navIconClass(activeNav === 'sites')} />
                Manage Sites
              </Link>
              <Link to="/admin/staff" className={navItemClass(activeNav === 'staff')} aria-current={activeNav === 'staff' ? 'page' : undefined}>
                <UsersIcon className={navIconClass(activeNav === 'staff')} />
                Staff Access
              </Link>
            </>
          )}
        </nav>

        <div className="p-2.5 border-t border-white/10 relative" ref={userMenu.containerRef}>
          {/* Single click-to-open trigger for the whole footer (Gmail/Slack
              pattern) — replaces the old user-row-link + separate sign-out-button
              split, which the captain flagged as reading "squashed". The menu
              being a deliberate second click already guards against the
              accidental-sign-out problem the old confirm-popover solved, so
              that extra confirm step is dropped as redundant. */}
          <button
            type="button"
            {...userMenu.buttonProps}
            className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-white/10"
          >
            <span
              className="w-6 h-6 rounded-full bg-accent text-primary-900 text-[10px] font-semibold flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-xs font-medium text-white truncate">{email}</span>
              <span className="block text-[10px] text-white/70">SpaceBook</span>
            </span>
            <ChevronDownIcon
              className={`w-3.5 h-3.5 text-white/50 shrink-0 transition-transform ${userMenu.open ? 'rotate-180' : ''}`}
            />
          </button>

          {userMenu.open && (
            <div
              {...userMenu.menuProps}
              className="absolute bottom-full left-2.5 right-2.5 mb-1.5 bg-primary-800 border border-white/10 rounded-lg shadow-lg py-1 z-10"
            >
              <Link
                to="/account"
                role="menuitem"
                tabIndex={-1}
                onClick={() => userMenu.close(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white focus:bg-white/10"
              >
                <IdentificationIcon className="w-4 h-4 shrink-0" />
                Account settings
              </Link>
              <div className="my-1 border-t border-white/10" role="separator" />
              <Link
                to="/logout"
                role="menuitem"
                tabIndex={-1}
                onClick={() => userMenu.close(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white focus:bg-white/10"
              >
                <SignOutIcon className="w-4 h-4 shrink-0" />
                Sign out
              </Link>
            </div>
          )}
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 md:px-5 py-3 border-b border-hairline bg-surface shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              ref={navButtonRef}
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-expanded={navOpen}
              aria-controls="staff-sidebar"
              className="md:hidden -ml-1 w-9 h-9 flex items-center justify-center rounded-lg text-ink-2 hover:bg-canvas"
            >
              <MenuIcon className="w-5 h-5" />
              <span className="sr-only">Menu</span>
            </button>
            <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {headerExtra}
            {site && <SiteBadge site={site} label={siteLabel} color={siteColor} />}
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 min-w-0 overflow-y-auto p-4 md:p-5 flex flex-col gap-4 focus:outline-none"
        >
          {children}
          <AccessibilityFooter className="mt-auto pt-4" />
        </main>
      </div>
    </div>
  );
}
