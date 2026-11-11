import { useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDayColumn } from '../components/staff/CalendarDayColumn';
import { CalendarSubscribeModal } from '../components/staff/CalendarSubscribeModal';
import { CalendarMonthDayCell } from '../components/staff/CalendarMonthDayCell';
import { DayTimelinePanel } from '../components/staff/DayTimelinePanel';
import { StaffLayout } from '../components/StaffLayout';
import { CalendarIcon } from '../components/icons';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { useMonthAvailability } from '../hooks/useMonthAvailability';
import { useRooms } from '../hooks/useRooms';
import { useSites } from '../hooks/useSites';
import {
  addDays,
  addMonths,
  formatMonthYear,
  formatShort,
  getMonthGridDays,
  startOfMonth,
  startOfWeek,
  toISODate,
} from '../lib/dates';

type ViewMode = 'week' | 'month';

export default function StaffCalendarPage() {
  const { site = '' } = useParams<{ site: string }>();
  const { data: roomsData } = useRooms(site);
  const rooms = roomsData?.rooms ?? [];
  const { data: sitesData } = useSites();
  const siteLabel = sitesData?.sites.find((s) => s.id === site)?.label ?? site;
  const [roomFilter, setRoomFilter] = useState('');
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  // The day the bottom detail timeline shows; null means today. Set by clicking
  // any day cell (week or month); the inline panel steps it with its ‹/›
  // buttons and resets to today via its "Today" button.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todayIso = useMemo(() => toISODate(new Date()), []);
  const detailIso = selectedDate ?? todayIso;
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const monthDays = useMemo(() => getMonthGridDays(monthStart), [monthStart]);
  const monthDayIsos = useMemo(() => monthDays.map(toISODate), [monthDays]);

  const rangeHeadingId = useId();
  const rangeLabel = viewMode === 'week' ? `Week of ${formatShort(weekStart)}` : formatMonthYear(monthStart);
  const unit = viewMode === 'week' ? 'week' : 'month';

  const { bookingsByDate, loadingByDate } = useMonthAvailability(site, viewMode === 'month' ? monthDayIsos : []);

  function goPrev() {
    if (viewMode === 'week') setWeekStart(addDays(weekStart, -7));
    else setMonthStart(addMonths(monthStart, -1));
  }

  function goNext() {
    if (viewMode === 'week') setWeekStart(addDays(weekStart, 7));
    else setMonthStart(addMonths(monthStart, 1));
  }

  function jumpTo(dateStr: string) {
    if (!dateStr) return;
    const picked = new Date(`${dateStr}T00:00:00`);
    if (viewMode === 'week') setWeekStart(startOfWeek(picked));
    else setMonthStart(startOfMonth(picked));
  }

  function switchView(next: ViewMode) {
    if (next === viewMode) return;
    if (next === 'month') setMonthStart(startOfMonth(weekStart));
    else setWeekStart(startOfWeek(monthStart));
    setViewMode(next);
  }

  return (
    <StaffLayout activeNav="calendar" site={site} title="Room Availability">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <ToggleGroup
            label="Calendar view"
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
            value={viewMode}
            onChange={switchView}
          />
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={goPrev}
              aria-label={`Previous ${unit}`}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-hairline-strong bg-surface text-ink-3 hover:bg-canvas"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label={`Next ${unit}`}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-hairline-strong bg-surface text-ink-3 hover:bg-canvas"
            >
              ›
            </button>
            {/* Live so the new range is announced after ‹/›, the view toggle, or a date jump. */}
            <h2 id={rangeHeadingId} aria-live="polite" aria-atomic="true" className="ml-1 text-sm font-semibold text-ink">
              {rangeLabel}
            </h2>
          </div>
          <input
            type="date"
            aria-label="Jump to date"
            className="rounded-lg border border-field bg-surface text-sm px-2.5 py-1.5 text-ink-2"
            value={toISODate(viewMode === 'week' ? weekStart : monthStart)}
            onChange={(e) => jumpTo(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Filter by room"
            className="rounded-lg border border-field bg-surface text-sm px-2.5 py-1.5 text-ink-2"
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
          >
            <option value="">All Rooms</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowSubscribe(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface text-sm font-medium px-2.5 py-1.5 text-ink-2 hover:bg-canvas"
          >
            <CalendarIcon className="w-4 h-4" />
            Subscribe in Outlook
          </button>
        </div>
      </div>

      {/* The 7-column grid is 2-D content, so below ~560px it scrolls sideways
          inside its own box (allowed by WCAG 1.4.10) rather than the page. */}
      {viewMode === 'week' ? (
        <div className="relative overflow-x-auto">
          <ol aria-labelledby={rangeHeadingId} className="grid grid-cols-7 gap-1 min-w-[560px]">
          {weekDays.map((day) => {
            const iso = toISODate(day);
            return (
              <li key={iso}>
              <CalendarDayColumn
                site={site}
                date={iso}
                label={formatShort(day)}
                rooms={rooms}
                roomFilter={roomFilter}
                isToday={iso === todayIso}
                isSelected={iso === detailIso}
                onSelect={() => setSelectedDate(iso)}
              />
              </li>
            );
          })}
          </ol>
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <ol aria-labelledby={rangeHeadingId} className="grid grid-cols-7 gap-1 min-w-[560px]">
          {monthDays.map((day) => {
            const iso = toISODate(day);
            return (
              <li key={iso}>
              <CalendarMonthDayCell
                date={day}
                bookings={bookingsByDate.get(iso) ?? []}
                rooms={rooms}
                roomFilter={roomFilter}
                isToday={iso === todayIso}
                isCurrentMonth={day.getMonth() === monthStart.getMonth()}
                isLoading={loadingByDate.get(iso) ?? false}
                isSelected={iso === detailIso}
                onSelect={() => setSelectedDate(iso)}
              />
              </li>
            );
          })}
          </ol>
        </div>
      )}

      <section aria-label="Day schedule" className="rounded-2xl border border-hairline bg-surface p-4">
        <DayTimelinePanel
          site={site}
          date={detailIso}
          rooms={rooms}
          roomFilter={roomFilter}
          isToday={detailIso === todayIso}
          onToday={() => setSelectedDate(null)}
          onNavigate={(delta) =>
            setSelectedDate(toISODate(addDays(new Date(`${detailIso}T00:00:00`), delta)))
          }
        />
      </section>
      {showSubscribe && (
        <CalendarSubscribeModal site={site} siteLabel={siteLabel} onClose={() => setShowSubscribe(false)} />
      )}
    </StaffLayout>
  );
}
