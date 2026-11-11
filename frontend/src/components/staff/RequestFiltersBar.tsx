import type { Room } from '../../types/api';
import { ShowPastToggle } from '../ui/ShowPastToggle';

export interface QueueFilters {
  status: string;
  room: string;
  type: string;
  showPast: boolean;
}

interface Props {
  filters: QueueFilters;
  onChange: (filters: QueueFilters) => void;
  rooms: Room[];
  pastCount: number;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'counter_proposed', label: 'Counter-Proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'cancellation_requested', label: 'Cancellation Requested' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TYPE_OPTIONS = ['Academic Event', 'Community Event', 'University Event'];

export function RequestFiltersBar({ filters, onChange, rooms, pastCount }: Props) {
  const hasActiveFilter = Boolean(filters.status || filters.room || filters.type);

  const chipClass = (active: boolean) =>
    `rounded-lg border text-[13px] px-3 py-2 bg-surface transition-colors ${
      active ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-field text-ink-2'
    }`;

  // The selects' first option ("All Statuses") reads as a label visually, but
  // it isn't one for assistive tech, so each select carries its own name.
  return (
    <div role="group" aria-label="Filter requests" className="flex flex-wrap items-center gap-2.5">
      <select
        aria-label="Filter by status"
        className={chipClass(Boolean(filters.status))}
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by room"
        className={chipClass(Boolean(filters.room))}
        value={filters.room}
        onChange={(e) => onChange({ ...filters, room: e.target.value })}
      >
        <option value="">All Rooms</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by event type"
        className={chipClass(Boolean(filters.type))}
        value={filters.type}
        onChange={(e) => onChange({ ...filters, type: e.target.value })}
      >
        <option value="">All Event Types</option>
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <ShowPastToggle checked={filters.showPast} onChange={(showPast) => onChange({ ...filters, showPast })} pastCount={pastCount} />
      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => onChange({ ...filters, status: '', room: '', type: '' })}
          className="text-[13px] text-ink-3 hover:text-ink-2 px-2 py-1.5 rounded-lg"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
