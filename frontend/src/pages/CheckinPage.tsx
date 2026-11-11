import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StaffLayout } from '../components/StaffLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useCheckIn, useMarkNoShow, useUndoCheckin } from '../hooks/useCheckin';
import { useRooms } from '../hooks/useRooms';
import { useSiteRequests } from '../hooks/useSiteRequests';
import { useSites } from '../hooks/useSites';
import { toMinutes } from '../lib/availability';
import { toISODate } from '../lib/dates';
import type { BookingRequest } from '../types/api';

type CardState = 'upcoming' | 'active' | 'overdue' | 'checked_in' | 'no_show';

// ─── Card sub-component ───────────────────────────────────────────────────────

interface CheckinCardProps {
  booking: BookingRequest;
  state: CardState;
  roomLabel: string;
  onCheckIn: () => void;
  onUndo: () => void;
  isCheckinPending: boolean;
  isUndoPending: boolean;
}

function CheckinCard({ booking, state, roomLabel, onCheckIn, onUndo, isCheckinPending, isUndoPending }: CheckinCardProps) {
  const containerClass: Record<CardState, string> = {
    upcoming: 'bg-surface border border-hairline',
    active: 'bg-surface border-2 border-primary-200',
    overdue: 'bg-warn-bg border border-warn-fg',
    checked_in: 'bg-ok-bg border border-ok-fg',
    no_show: 'bg-err-bg border border-err-fg',
  };

  return (
    <div className={`rounded-2xl p-4 flex flex-wrap items-start gap-4 ${containerClass[state]}`}>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
          <span className="text-sm font-semibold text-ink">
            {booking.start} – {booking.end}
          </span>
          <span className="text-xs text-ink-3">·</span>
          <span className="text-xs text-ink-2">{roomLabel}</span>
          {state === 'active' && (
            <span className="text-xs font-medium text-primary-600 bg-primary-50 rounded-full px-2 py-0.5">
              Happening now
            </span>
          )}
          {/* The amber tint alone isn't enough to convey "overdue" (WCAG 1.4.1). */}
          {state === 'overdue' && <Badge variant="warning">Overdue — not checked in</Badge>}
        </div>
        <h3 className="text-sm font-medium text-ink truncate">{booking.title}</h3>
        <p className="text-xs text-ink-3 mt-0.5">
          {booking.org} · {booking.attendance} attending
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {state === 'checked_in' && (
          <>
            <Badge variant="success">Checked In</Badge>
            <Button variant="secondary" isLoading={isUndoPending} onClick={onUndo}
              className="!w-auto !py-1.5 !px-3 !text-xs">
              Undo<span className="sr-only"> check-in for {booking.title}</span>
            </Button>
          </>
        )}
        {state === 'no_show' && (
          <>
            <Badge variant="error">No-Show</Badge>
            <Button variant="secondary" isLoading={isUndoPending} onClick={onUndo}
              className="!w-auto !py-1.5 !px-3 !text-xs">
              Undo<span className="sr-only"> no-show for {booking.title}</span>
            </Button>
          </>
        )}
        {(state === 'upcoming' || state === 'overdue') && (
          <Button variant="secondary" isLoading={isCheckinPending} onClick={onCheckIn}
            className="!w-auto !py-1.5 !px-3 !text-xs">
            Check In<span className="sr-only"> {booking.title}</span>
          </Button>
        )}
        {state === 'active' && (
          <Button variant="primary" isLoading={isCheckinPending} onClick={onCheckIn}
            className="!w-auto !py-1.5 !px-3 !text-xs">
            Check In<span className="sr-only"> {booking.title}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CheckinPage() {
  const { site = '' } = useParams<{ site: string }>();

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const selectedIso = toISODate(selectedDate);
  const todayIso = toISODate(new Date());
  const isToday = selectedIso === todayIso;

  function navigateDay(delta: number) {
    setSelectedDate((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta);
      return next;
    });
  }

  const { data, isLoading } = useSiteRequests(site, { status: 'approved', date: selectedIso });
  const { data: roomsData } = useRooms(site);
  const { data: sitesData } = useSites();

  const roomName = useMemo(() => {
    const map = new Map((roomsData?.rooms ?? []).map((r) => [r.id, r.name]));
    return (id: string) => map.get(id) ?? id;
  }, [roomsData]);

  const siteInfo = sitesData?.sites.find((s) => s.id === site);

  const sortedBookings = useMemo(
    () => [...(data?.requests ?? [])].sort((a, b) => a.start.localeCompare(b.start)),
    [data],
  );

  function cardState(booking: BookingRequest): CardState {
    if (booking.checkInStatus === 'checked_in') return 'checked_in';
    if (booking.checkInStatus === 'no_show') return 'no_show';
    if (!isToday) return 'upcoming';
    const startMin = toMinutes(booking.start);
    const endMin = toMinutes(booking.end);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= startMin + 15) return 'overdue';
    if (nowMin >= startMin && nowMin < endMin) return 'active';
    return 'upcoming';
  }

  const overdueBookings = sortedBookings.filter((b) => cardState(b) === 'overdue');

  const checkInMutation = useCheckIn();
  const noShowMutation = useMarkNoShow();
  const undoMutation = useUndoCheckin();
  const mutationError = checkInMutation.error ?? noShowMutation.error ?? undoMutation.error;

  return (
    <StaffLayout
      activeNav="checkin"
      site={site}
      siteLabel={siteInfo?.label}
      siteColor={siteInfo?.color}
      title="Check-In"
    >
      {isToday && overdueBookings.length > 0 && (
        // Not sticky: a pinned banner can fully hide the card a keyboard user
        // just tabbed to (WCAG 2.4.11). Offsets match <main>'s p-4 md:p-5.
        <div
          role="status"
          className="-mx-4 -mt-4 px-4 md:-mx-5 md:-mt-5 md:px-5 py-3 bg-warn-bg border-b border-warn-fg/20 flex flex-col gap-2"
        >
          <p className="text-sm font-semibold text-warn-fg">
            {overdueBookings.length} booking{overdueBookings.length !== 1 ? 's' : ''} started over
            15 minutes ago with no check-in
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {overdueBookings.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="text-sm text-warn-fg">
                  {b.start} · {roomName(b.room)} — {b.org}
                </span>
                <Button
                  variant="outline"
                  isLoading={noShowMutation.isPending && noShowMutation.variables?.id === b.id}
                  onClick={() => noShowMutation.mutate({ id: b.id })}
                  className="!w-auto !py-1 !px-2.5 !text-xs !border-warn-fg !text-warn-fg hover:!bg-warn-fg/10"
                >
                  Mark No-Show<span className="sr-only"> for {b.title}</span>
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {mutationError && (
        <p role="alert" className="text-sm text-err-fg">
          Couldn't update check-in: {mutationError.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => navigateDay(-1)}
            className="w-7 h-7 grid place-items-center rounded-lg border border-hairline-strong text-ink-3 hover:bg-canvas text-base"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => navigateDay(1)}
            className="w-7 h-7 grid place-items-center rounded-lg border border-hairline-strong text-ink-3 hover:bg-canvas text-base"
          >
            ›
          </button>
          <h2 aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-ink ml-1">
            {selectedDate.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </h2>
        </div>
        {!isToday && (
          <button
            type="button"
            onClick={() => setSelectedDate(new Date())}
            className="min-h-6 px-2 py-1 rounded-md text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50"
          >
            Today
          </button>
        )}
      </div>

      {isLoading ? (
        <p role="status" className="text-sm text-ink-3">
          Loading bookings…
        </p>
      ) : sortedBookings.length === 0 ? (
        <p className="text-sm text-ink-3">No approved bookings for this date.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Approved bookings">
          {sortedBookings.map((b) => {
            const state = cardState(b);
            return (
              <li key={b.id}>
              <CheckinCard
                booking={b}
                state={state}
                roomLabel={roomName(b.room)}
                onCheckIn={() => checkInMutation.mutate({ id: b.id })}
                onUndo={() => undoMutation.mutate({ id: b.id })}
                isCheckinPending={checkInMutation.isPending && checkInMutation.variables?.id === b.id}
                isUndoPending={undoMutation.isPending && undoMutation.variables?.id === b.id}
              />
              </li>
            );
          })}
        </ul>
      )}
    </StaffLayout>
  );
}
