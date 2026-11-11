import { useQueries } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { listRooms } from '../api/rooms';
import { listSiteRequests } from '../api/requestsStaff';
import { CalendarIcon, ChartBarIcon, CheckCircleIcon, ClockIcon } from '../components/icons';
import { StaffLayout } from '../components/StaffLayout';
import { toLabel, toMinutes } from '../lib/availability';
import { toISODate } from '../lib/dates';
import { canManageSite } from '../lib/siteAccess';
import { useAuth } from '../hooks/useAuth';
import { useOperatingSite } from '../hooks/useOperatingSite';
import { useSites } from '../hooks/useSites';
import { useSitesSummary } from '../hooks/useSitesSummary';

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function timeRange(start: string, end: string): string {
  return `${toLabel(toMinutes(start))}–${toLabel(toMinutes(end))}`;
}

function Kpi({ icon, tint, label, value, info }: { icon: ReactNode; tint: string; label: string; value: ReactNode; info?: ReactNode }) {
  // The info popover is a disclosure: it opens on hover (as before) and on
  // click/Enter/Space of its button, and Escape dismisses it (WCAG 2.1.1, 1.4.13).
  const [open, setOpen] = useState(false);
  const infoId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function handlePointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 col-span-1">
      <div className="relative flex items-center gap-2 text-xs text-ink-3">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${tint}`} aria-hidden="true">
          {icon}
        </span>
        <h2 className="font-normal">{label}</h2>
        {info && (
          <span
            ref={wrapRef}
            className="ml-auto"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls={infoId}
              aria-label={`About ${label}`}
              className="w-6 h-6 -m-1 grid place-items-center rounded-full"
            >
              <span
                className="w-4 h-4 rounded-full border border-ink-4 text-ink-4 flex items-center justify-center text-[10px] font-semibold select-none leading-none"
                aria-hidden="true"
              >
                i
              </span>
            </button>
            <div
              id={infoId}
              hidden={!open}
              className="absolute top-full right-0 mt-2 w-60 max-w-[calc(100vw-3rem)] rounded-xl border border-hairline bg-surface shadow-lg p-3 text-xs text-ink-2 z-20 leading-relaxed"
            >
              {info}
            </div>
          </span>
        )}
      </div>
      <p className="text-[26px] leading-none font-bold text-ink mt-3">{value}</p>
    </div>
  );
}

// Bento-grid dashboard (Option C of the Mobbin-referenced redesign, approved
// via Lavish, ref .lavish/dashboard-redesign.html). KPIs + status donut come
// from GET /api/admin/sites (sites_summary, scoped server-side). The pending
// queue, today's schedule, and busiest rooms are derived client-side from the
// site request lists + room catalogs (same data Manage Requests/the calendar
// already fetch, deduped by React Query) — no backend change.
export default function DashboardPage() {
  const { data, isLoading, error } = useSitesSummary();
  const { data: sitesData } = useSites();
  const { idToken, getIdToken, groups } = useAuth();
  const { setOperatingSite } = useOperatingSite();

  const sitesSummaryData = data?.sites ?? {};
  const siteIds = Object.keys(sitesSummaryData);
  // Sites this account manages (vs. check-in only). Only these get the
  // pending-approvals card, since only they can open the queue.
  const managedSiteIds = siteIds.filter((site) => canManageSite(groups, site));
  const siteDirectory = sitesData?.sites ?? [];
  const todayIso = toISODate(new Date());

  // Per-site request lists and room catalogs across every site this account
  // can see. useQueries reuses the same query keys as useSiteRequests/useRooms,
  // so these dedupe with the queue and calendar pages rather than refetching.
  const requestResults = useQueries({
    queries: siteIds.map((site) => ({
      queryKey: ['siteRequests', site, {}],
      queryFn: async () => listSiteRequests(site, {}, await getIdToken()),
      enabled: Boolean(idToken && site),
    })),
  });
  const roomResults = useQueries({
    queries: siteIds.map((site) => ({
      queryKey: ['rooms', site],
      queryFn: async () => listRooms(site),
      staleTime: 5 * 60 * 1000,
      enabled: Boolean(site),
    })),
  });

  const allRequests = requestResults.flatMap((r, i) =>
    (r.data?.requests ?? []).map((req) => ({ ...req, _site: siteIds[i] })),
  );
  const roomMap = new Map<string, { name: string; emoji: string }>();
  for (const r of roomResults) {
    for (const rm of r.data?.rooms ?? []) roomMap.set(rm.id, { name: rm.name, emoji: rm.emoji });
  }
  const roomName = (id: string) => roomMap.get(id)?.name ?? id;
  const roomEmoji = (id: string) => roomMap.get(id)?.emoji ?? '📍';

  // KPI + donut figures from the authoritative server-side counts.
  const totals = Object.values(sitesSummaryData).reduce<Record<string, number>>((acc, counts) => {
    for (const [status, count] of Object.entries(counts)) acc[status] = (acc[status] ?? 0) + count;
    return acc;
  }, {});
  const pendingTotal = (totals.pending_approval ?? 0) + (totals.counter_proposed ?? 0);
  const approvedTotal = totals.approved ?? 0;
  const deniedTotal = totals.denied ?? 0;
  const cancelledTotal = (totals.cancelled ?? 0) + (totals.cancellation_requested ?? 0);
  const totalRequests = approvedTotal + deniedTotal + pendingTotal + cancelledTotal;
  const approvalRate =
    totalRequests > 0 ? Math.round((approvedTotal / totalRequests) * 100) : null;

  // Derived detail lists.
  const pending = allRequests
    .filter((r) => managedSiteIds.includes(r._site))
    .filter((r) => r.status === 'pending_approval' || r.status === 'counter_proposed')
    .sort((a, b) => (a.date === b.date ? toMinutes(a.start) - toMinutes(b.start) : a.date.localeCompare(b.date)))
    .slice(0, 5);
  const todayEvents = allRequests
    .filter((r) => r.status === 'approved' && r.date === todayIso)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  const roomCounts = new Map<string, number>();
  for (const r of allRequests) {
    if (r.status === 'approved') roomCounts.set(r.room, (roomCounts.get(r.room) ?? 0) + 1);
  }
  const busiest = [...roomCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxRoom = Math.max(1, ...busiest.map((b) => b.count));

  // Donut segments (only non-zero), with cumulative offsets for the SVG arcs.
  const donutRaw = [
    { label: 'Approved', value: approvedTotal, color: '#13703F' },
    { label: 'Pending', value: pendingTotal, color: '#93570A' },
    { label: 'Denied', value: deniedTotal, color: '#B4312A' },
    { label: 'Cancelled', value: cancelledTotal, color: '#5A6472' },
  ].filter((s) => s.value > 0);
  const donutTotal = donutRaw.reduce((a, s) => a + s.value, 0);
  let cumulative = 0;
  const donutSegs = donutRaw.map((s) => {
    const dash = donutTotal > 0 ? (s.value / donutTotal) * 100 : 0;
    const seg = { ...s, dash, offset: -cumulative };
    cumulative += dash;
    return seg;
  });

  return (
    <StaffLayout
      activeNav="dashboard"
      title="Dashboard"
      headerExtra={
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2 bg-surface border border-hairline-strong rounded-full px-2.5 py-1">
          <span className="w-2 h-2 rounded-full bg-primary-600" aria-hidden="true" />
          {siteIds.length} site{siteIds.length === 1 ? '' : 's'}
        </span>
      }
    >
      {isLoading && (
        <p role="status" className="text-sm text-ink-3">
          Loading dashboard…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-err-fg">
          Couldn't load the dashboard.
        </p>
      )}

      {!isLoading && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* KPIs */}
          <Kpi icon={<ClockIcon className="w-3.5 h-3.5" />} tint="bg-warn-bg text-warn-fg" label="Pending review" value={pendingTotal} />
          <Kpi icon={<CheckCircleIcon className="w-3.5 h-3.5" />} tint="bg-ok-bg text-ok-fg" label="Approved" value={approvedTotal} />
          <Kpi
            icon={<ChartBarIcon className="w-3.5 h-3.5" />}
            tint="bg-info-bg text-info-fg"
            label="Approval rate"
            value={approvalRate === null ? '—' : `${approvalRate}%`}
            info={
              <span>
                <span className="font-semibold text-ink">Approval rate</span>
                <br />
                = approved ÷ all requests submitted.
                {totalRequests > 0 && (
                  <>
                    <br /><br />
                    <span className="tabular-nums">
                      {approvedTotal} approved ÷ {totalRequests} total requests
                      <br />
                      ({approvedTotal} approved · {deniedTotal} denied · {pendingTotal} pending · {cancelledTotal} cancelled)
                    </span>
                  </>
                )}
              </span>
            }
          />
          <Kpi icon={<CalendarIcon className="w-3.5 h-3.5" />} tint="bg-neu-bg text-neu-fg" label="Events today" value={todayEvents.length} />

          {/* Status donut */}
          <div className="rounded-2xl border border-hairline bg-surface p-4 col-span-2 lg:col-span-1">
            <h2 className="font-semibold text-[13px] text-ink mb-2">Status</h2>
            {donutTotal === 0 ? (
              <p className="text-[12px] text-ink-3">No requests yet.</p>
            ) : (
              <>
                <svg
                  viewBox="0 0 36 36"
                  className="w-full h-24"
                  role="img"
                  aria-label={`Request status breakdown, ${donutTotal} total: ${donutSegs.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(', ')}`}
                >
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#EEF0F4" strokeWidth="4" />
                  {donutSegs.map((s) => (
                    <circle
                      key={s.label}
                      cx="18"
                      cy="18"
                      r="15.9155"
                      fill="none"
                      stroke={s.color}
                      strokeWidth="4"
                      strokeDasharray={`${s.dash} ${100 - s.dash}`}
                      strokeDashoffset={s.offset}
                      transform="rotate(-90 18 18)"
                    />
                  ))}
                  <text x="18" y="17.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#101827">
                    {donutTotal}
                  </text>
                  <text x="18" y="23" textAnchor="middle" fontSize="3.2" fill="#525B6C">
                    total
                  </text>
                </svg>
                <ul className="text-[11.5px] space-y-1 mt-2" aria-label="Status legend">
                  {donutSegs.map((s) => (
                    <li key={s.label} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                      {s.label} <span className="text-ink-4">{s.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Pending approvals */}
          {managedSiteIds.length > 0 && (
            <div className="rounded-2xl border border-hairline bg-surface col-span-2 lg:col-span-3">
              <div className="flex items-center justify-between px-4 py-3 border-b border-hairline">
                <h2 className="font-semibold text-sm text-ink">Pending approvals</h2>
                {managedSiteIds.length > 0 && (
                  <Link to={`/staff/${managedSiteIds[0]}/queue`} className="text-xs font-medium text-primary-600 hover:text-primary-700 py-1">
                    View all<span className="sr-only"> pending requests</span> <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
              {pending.length === 0 ? (
                <p className="text-sm text-ink-3 px-4 py-6 text-center">No requests waiting — you're all caught up. <span aria-hidden="true">🎉</span></p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {pending.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink truncate">
                          {r.title} <span className="text-ink-3 font-normal">· {r.org}</span>
                        </div>
                        <div className="text-[12px] text-ink-3 truncate">
                          {shortDate(r.date)} · {timeRange(r.start, r.end)} · {roomName(r.room)} · {r.attendance} <span aria-hidden="true">ppl</span><span className="sr-only">people</span>
                        </div>
                      </div>
                      <Link
                        to={`/staff/${r._site}/queue`}
                        // Switch the sidebar's active site to this request's site up
                        // front, so the queue opens already scoped to it.
                        onClick={() => setOperatingSite(r._site)}
                        className="text-[12px] font-medium px-2.5 py-1 rounded-lg bg-primary-600 text-white hover:bg-primary-700 shrink-0"
                      >
                        Review<span className="sr-only"> {r.title}, {shortDate(r.date)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Today's schedule */}
          <div className="rounded-2xl border border-hairline bg-surface col-span-2">
            <div className="px-4 py-3 border-b border-hairline">
              <h2 className="font-semibold text-sm text-ink">Today's schedule</h2>
            </div>
            {todayEvents.length === 0 ? (
              <p className="text-sm text-ink-3 px-4 py-6 text-center">No events scheduled today.</p>
            ) : (
              <ul className="divide-y divide-hairline text-[12.5px]">
                {todayEvents.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="font-semibold text-ink w-28 shrink-0">{timeRange(r.start, r.end)}</span>
                    <span className="truncate text-ink-2">
                      <span aria-hidden="true">{roomEmoji(r.room)}</span> {roomName(r.room)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Busiest rooms */}
          <div className="rounded-2xl border border-hairline bg-surface col-span-2 p-4">
            <h2 className="font-semibold text-sm text-ink mb-3">Busiest rooms</h2>
            {busiest.length === 0 ? (
              <p className="text-sm text-ink-3 py-2">No approved bookings yet.</p>
            ) : (
              <ul className="space-y-2 text-[12.5px]">
                {busiest.map((b) => (
                  <li key={b.id} className="flex items-center gap-3">
                    <span className="w-24 sm:w-32 truncate text-ink-2">{roomName(b.id)}</span>
                    <span className="flex-1 h-2.5 rounded-full bg-neu-bg overflow-hidden" aria-hidden="true">
                      <span className="block h-full rounded-full bg-primary-600" style={{ width: `${(b.count / maxRoom) * 100}%` }} />
                    </span>
                    <span className="w-5 text-right font-semibold">
                      {b.count}
                      <span className="sr-only"> approved booking{b.count === 1 ? '' : 's'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Requests by site (kept from the original dashboard) */}
          <div className="rounded-2xl border border-hairline bg-surface col-span-2 lg:col-span-4">
            <div className="px-4 py-3 border-b border-hairline">
              <h2 className="font-semibold text-sm text-ink">Requests by site</h2>
            </div>
            {siteIds.length === 0 ? (
              <p className="text-sm text-ink-3 px-4 py-4">No sites on this account yet.</p>
            ) : (
              <ul>
                {siteIds.map((id) => {
                  const site = siteDirectory.find((s) => s.id === id);
                  const total = sumCounts(sitesSummaryData[id] ?? {});
                  const color = site?.color ?? '#6B7280';
                  const maxSiteTotal = Math.max(1, ...siteIds.map((s) => sumCounts(sitesSummaryData[s] ?? {})));
                  return (
                    <li key={id} className="flex items-center gap-3 px-4 py-2.5 border-t border-hairline first:border-t-0">
                      <span className="w-24 sm:w-32 shrink-0 flex items-center gap-2 text-[13px] font-medium text-ink-2 truncate">
                        <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: color }} aria-hidden="true" />
                        <span className="truncate">{site?.label ?? id}</span>
                      </span>
                      <div className="flex-1 h-2.5 bg-neu-bg rounded-full overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${(total / maxSiteTotal) * 100}%`, background: color }} />
                      </div>
                      <span className="w-8 text-right text-[13px] font-semibold text-ink-2">
                        {total}
                        <span className="sr-only"> request{total === 1 ? '' : 's'}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </StaffLayout>
  );
}
