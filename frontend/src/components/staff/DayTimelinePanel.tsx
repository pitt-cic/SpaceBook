import { useMemo, useState } from 'react';
import { useAvailability } from '../../hooks/useAvailability';
import { useSiteRequests } from '../../hooks/useSiteRequests';
import { DAY_END, DAY_START, toLabel, toMinutes } from '../../lib/availability';
import type { BookingRequest, Room } from '../../types/api';

interface Props {
  site: string;
  date: string; // ISO yyyy-mm-dd
  rooms: Room[];
  roomFilter: string;
  isToday: boolean;
  onToday: () => void;
  onNavigate: (deltaDays: number) => void;
}

function panelBounds(rooms: Room[]): { panelStart: number; panelEnd: number } {
  if (!rooms.length) return { panelStart: DAY_START, panelEnd: DAY_END };
  const opens = rooms.map((r) => toMinutes(r.openTime ?? '09:00'));
  const closes = rooms.map((r) => toMinutes(r.closeTime ?? '17:00'));
  return { panelStart: Math.min(...opens), panelEnd: Math.max(...closes) };
}

function makeGeom(panelStart: number, panelEnd: number) {
  const span = panelEnd - panelStart;
  return function geom(startMin: number, endMin: number) {
    const s = Math.max(startMin, panelStart);
    const e = Math.min(endMin, panelEnd);
    const left = ((s - panelStart) / span) * 100;
    const width = Math.max(((e - s) / span) * 100, 0);
    return { left, width };
  };
}

// Option B of the day-detail redesign (captain-approved via Lavish, ref
// .lavish/day-detail-redesign.html), rendered inline in place of the "Room
// usage" panel rather than as a popup: clicking a calendar day swaps the
// bottom card for this rooms × 9AM–5PM timeline of the day's approved
// bookings. Time/room come from the availability endpoint; org/title/
// attendance are enriched by cross-referencing the site's approved requests
// for that date (the same client-side technique lib/conflicts.ts uses),
// matched on room+start+end — the availability endpoint doesn't carry them.
export function DayTimelinePanel({ site, date, rooms, roomFilter, isToday, onToday, onNavigate }: Props) {
  const { panelStart, panelEnd } = panelBounds(rooms);
  const hourStart = Math.floor(panelStart / 60);
  const hourEnd = Math.ceil(panelEnd / 60);
  const HOUR_MARKS = Array.from({ length: hourEnd - hourStart + 1 }, (_, i) => hourStart + i);
  const geom = makeGeom(panelStart, panelEnd);

  const { data, isLoading } = useAvailability(site, date);
  const { data: requestsData } = useSiteRequests(site, { status: 'approved', date });

  // Enrichment: booking id (the request id) -> approved request (org/title/attendance).
  const requestById = useMemo(() => {
    const map = new Map<string, BookingRequest>();
    for (const r of requestsData?.requests ?? []) map.set(r.id, r);
    return map;
  }, [requestsData]);

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
  const roomEmoji = (id: string) => rooms.find((r) => r.id === id)?.emoji ?? '📍';

  const bookings = useMemo(
    () =>
      (data?.bookings ?? [])
        .filter((b) => !roomFilter || b.room === roomFilter)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start)),
    [data, roomFilter],
  );

  // Only rooms that actually have a booking (in start-time order). Free rooms
  // are hidden behind a toggle so a typical day fits on one screen instead of
  // listing all ~18 rooms as "Free all day".
  const bookedRoomIds = useMemo(() => {
    const ids: string[] = [];
    for (const b of bookings) if (!ids.includes(b.room)) ids.push(b.room);
    return ids;
  }, [bookings]);
  const freeRoomIds = useMemo(
    () =>
      rooms
        .map((r) => r.id)
        .filter((id) => !bookedRoomIds.includes(id) && (!roomFilter || id === roomFilter)),
    [rooms, bookedRoomIds, roomFilter],
  );
  const [showFree, setShowFree] = useState(false);
  const roomsToRender = showFree ? [...bookedRoomIds, ...freeRoomIds] : bookedRoomIds;

  const bookingsByRoom = useMemo(() => {
    const map = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const list = map.get(b.room) ?? [];
      list.push(b);
      map.set(b.room, list);
    }
    return map;
  }, [bookings]);

  const roomsInUse = bookingsByRoom.size;
  const hoursBooked = useMemo(() => {
    let mins = 0;
    for (const b of bookings) {
      mins += Math.max(0, Math.min(toMinutes(b.end), panelEnd) - Math.max(toMinutes(b.start), panelStart));
    }
    return mins / 60;
  }, [bookings, panelStart, panelEnd]);

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const hoursLabel = Number.isInteger(hoursBooked) ? `${hoursBooked}` : hoursBooked.toFixed(1);

  const timeAxisCols = 'grid grid-cols-[110px_1fr] sm:grid-cols-[190px_1fr] gap-3';

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="inline-flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate(-1)}
              aria-label="Previous day"
              className="w-7 h-7 grid place-items-center rounded-lg border border-hairline-strong text-ink-3 hover:bg-canvas"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => onNavigate(1)}
              aria-label="Next day"
              className="w-7 h-7 grid place-items-center rounded-lg border border-hairline-strong text-ink-3 hover:bg-canvas"
            >
              ›
            </button>
          </div>
          {/* Live so stepping days (or picking one in the grid above) announces
              the new date and its summary. */}
          <div className="min-w-0" aria-live="polite" aria-atomic="true">
            <h3 className="text-sm font-bold text-ink truncate">
              {dateLabel}
              {isToday && <span className="sr-only"> (today)</span>}
            </h3>
            <p className="text-[12px] text-ink-3">
              {isLoading
                ? 'Loading…'
                : `${bookings.length} booking${bookings.length === 1 ? '' : 's'} · ${roomsInUse} of ${rooms.length} rooms in use · ${hoursLabel}h booked`}
            </p>
          </div>
        </div>
        {!isToday && (
          <button
            type="button"
            onClick={onToday}
            className="shrink-0 min-h-6 px-2 py-1 rounded-md text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50"
          >
            Today
          </button>
        )}
      </div>

      {isLoading ? (
        <p role="status" className="text-sm text-ink-3">
          Loading the day's schedule…
        </p>
      ) : bookedRoomIds.length === 0 && !showFree ? (
        <p className="text-sm text-ink-3">
          No approved bookings on this day — all {freeRoomIds.length} rooms are free.
          {freeRoomIds.length > 0 && (
            <button
              type="button"
              onClick={() => setShowFree(true)}
              className="ml-2 text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              Show all rooms
            </button>
          )}
        </p>
      ) : (
        <>
          {/* time-axis header — visual only; each booking below carries its times as text */}
          <div className={timeAxisCols} aria-hidden="true">
            <div />
            <div className="relative h-5 text-[10px] text-ink-4">
              {HOUR_MARKS.map((h, i) => (
                <span
                  key={h}
                  className="absolute -translate-x-1/2"
                  style={{ left: `${(i / (HOUR_MARKS.length - 1)) * 100}%` }}
                >
                  {toLabel(h * 60)}
                </span>
              ))}
            </div>
          </div>

          {/* Rooms × bookings as nested lists: a screen reader hears each room and
              each booking's full details (the blocks' positions are visual only). */}
          <ul aria-label={`Bookings by room, ${dateLabel}`} className="space-y-1.5 mt-1 max-h-[420px] overflow-y-auto pr-1">
            {roomsToRender.map((roomId) => {
              const roomBookings = bookingsByRoom.get(roomId) ?? [];
              return (
                <li key={roomId} className={`${timeAxisCols} items-center`}>
                  <div className="text-[13px] text-ink-2 flex items-center gap-1.5 min-w-0" title={roomName(roomId)}>
                    <span aria-hidden="true" className="shrink-0">
                      {roomEmoji(roomId)}
                    </span>
                    <span className="truncate">{roomName(roomId)}</span>
                    <span className="sr-only">
                      : {roomBookings.length === 0
                        ? 'free all day'
                        : `${roomBookings.length} booking${roomBookings.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="relative h-8 rounded-lg bg-surface-2 border border-hairline">
                    {roomBookings.length === 0 && (
                      <span className="absolute inset-0 grid place-items-center text-[11px] text-ink-4" aria-hidden="true">
                        Free all day
                      </span>
                    )}
                    {roomBookings.length > 0 && (
                      <ul>
                        {roomBookings.map((b) => {
                          const startMin = toMinutes(b.start);
                          const endMin = toMinutes(b.end);
                          const { left, width } = geom(startMin, endMin);
                          const req = requestById.get(b.id);
                          const hasBuffers = b.eventStart && (b.eventStart !== b.start || b.eventEnd !== b.end);
                          const timeText = `${toLabel(startMin)}–${toLabel(endMin)}${
                            hasBuffers
                              ? ` (event ${toLabel(toMinutes(b.eventStart!))}–${toLabel(toMinutes(b.eventEnd!))})`
                              : ''
                          }`;
                          const tip = req
                            ? `${timeText} · ${req.title}${req.org ? ` — ${req.org}` : ''}${req.attendance ? ` · ${req.attendance} attending` : ''}`
                            : timeText;
                          // Spoken form: the block spans setup + event + cleanup, so say so.
                          const spoken = `${hasBuffers ? `Room held ${toLabel(startMin)} to ${toLabel(endMin)} including setup and cleanup; event ${toLabel(toMinutes(b.eventStart!))} to ${toLabel(toMinutes(b.eventEnd!))}` : `${toLabel(startMin)} to ${toLabel(endMin)}`}${
                            req ? `: ${req.title}${req.org ? `, ${req.org}` : ''}${req.attendance ? `, ${req.attendance} attending` : ''}` : ''
                          }`;
                          return (
                            <li
                              key={b.id}
                              title={tip}
                              className="absolute top-1 bottom-1 rounded-md bg-info-bg border-l-2 border-primary-500 text-[11px] text-info-fg px-2 flex items-center overflow-hidden"
                              style={{ left: `${left}%`, width: `${width}%` }}
                            >
                              <span className="truncate" aria-hidden="true">
                                {req ? req.title : timeText}
                              </span>
                              <span className="sr-only">{spoken}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {freeRoomIds.length > 0 && (
            <button
              type="button"
              onClick={() => setShowFree((v) => !v)}
              aria-expanded={showFree}
              className="mt-2 min-h-6 py-1 text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              {showFree
                ? 'Hide free rooms'
                : `Show ${freeRoomIds.length} free room${freeRoomIds.length === 1 ? '' : 's'}`}
            </button>
          )}

          <p className="text-[11px] text-ink-4 mt-3">
            Showing rooms with bookings. Times are approved bookings within room hours ({toLabel(panelStart)}–{toLabel(panelEnd)});
            hover a block for the org &amp; title.
          </p>
        </>
      )}
    </div>
  );
}
