import { ShowPastToggle } from '../ui/ShowPastToggle';
import { ToggleGroup } from '../ui/ToggleGroup';

export type SortField = 'date' | 'submittedAt' | 'title' | 'org';
export type SortDir = 'asc' | 'desc';

export interface MyRequestsSort {
  field: SortField;
  dir: SortDir;
}

export interface MyRequestsFilters {
  status: string;
  type: string;
  recurring: '' | 'yes' | 'no';
  search: string;
  showPast: boolean;
}

export const DEFAULT_SORT: MyRequestsSort = { field: 'submittedAt', dir: 'desc' };
export const DEFAULT_FILTERS: MyRequestsFilters = { status: '', type: '', recurring: '', search: '', showPast: false };

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

const SORT_FIELD_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'submittedAt', label: 'Date Submitted' },
  { value: 'date', label: 'Event Date' },
  { value: 'title', label: 'Title' },
  { value: 'org', label: 'Org' },
];

const SORT_DIR_OPTIONS: { value: SortDir; label: string }[] = [
  { value: 'desc', label: 'Desc' },
  { value: 'asc', label: 'Asc' },
];

interface Props {
  filters: MyRequestsFilters;
  onFiltersChange: (f: MyRequestsFilters) => void;
  sort: MyRequestsSort;
  onSortChange: (s: MyRequestsSort) => void;
  totalCount: number;
  filteredCount: number;
  pastCount: number;
}

const chipClass = (active: boolean) =>
  `rounded-lg border text-[13px] px-3 py-[7px] bg-surface transition-colors cursor-pointer font-sans ${
    active
      ? 'border-primary-200 bg-primary-50 text-primary-700'
      : 'border-field text-ink-2'
  }`;

export function MyRequestsFiltersBar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  totalCount,
  filteredCount,
  pastCount,
}: Props) {
  const isDefaultSort = sort.field === DEFAULT_SORT.field && sort.dir === DEFAULT_SORT.dir;
  const hasActiveFilter = Boolean(filters.status || filters.type || filters.recurring || filters.search);
  const isNonDefault = hasActiveFilter || !isDefaultSort;

  const clearAll = () => {
    onFiltersChange({ ...DEFAULT_FILTERS, showPast: filters.showPast });
    onSortChange(DEFAULT_SORT);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search. Every control here is labelled for screen readers: the
          placeholder / first option alone isn't an accessible name. */}
      <input
        type="search"
        aria-label="Search by title or organization"
        placeholder="Search by title or org…"
        value={filters.search}
        onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
        className={`rounded-lg border text-[13px] px-3 py-[7px] bg-surface font-sans w-44 outline-none transition-colors placeholder:text-ink-4 ${
          filters.search
            ? 'border-primary-500 ring-2 ring-primary-100 text-ink'
            : 'border-field text-ink focus:border-primary-500 focus:ring-2 focus:ring-primary-100'
        }`}
      />

      <div className="w-px h-7 bg-hairline-strong mx-0.5" aria-hidden="true" />

      {/* Status */}
      <select
        aria-label="Filter by status"
        className={chipClass(Boolean(filters.status))}
        value={filters.status}
        onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Event type */}
      <select
        aria-label="Filter by event type"
        className={chipClass(Boolean(filters.type))}
        value={filters.type}
        onChange={(e) => onFiltersChange({ ...filters, type: e.target.value })}
      >
        <option value="">All Event Types</option>
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Recurring */}
      <select
        aria-label="Filter by recurrence"
        className={chipClass(Boolean(filters.recurring))}
        value={filters.recurring}
        onChange={(e) =>
          onFiltersChange({ ...filters, recurring: e.target.value as MyRequestsFilters['recurring'] })
        }
      >
        <option value="">All Requests</option>
        <option value="yes">Recurring only</option>
        <option value="no">One-time only</option>
      </select>

      <ShowPastToggle
        checked={filters.showPast}
        onChange={(showPast) => onFiltersChange({ ...filters, showPast })}
        pastCount={pastCount}
      />

      <div className="w-px h-7 bg-hairline-strong mx-0.5" aria-hidden="true" />

      {/* Sort field */}
      <select
        aria-label="Sort by"
        className={chipClass(!isDefaultSort)}
        value={sort.field}
        onChange={(e) => onSortChange({ ...sort, field: e.target.value as SortField })}
      >
        {SORT_FIELD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Sort direction */}
      <ToggleGroup
        label="Sort direction"
        options={SORT_DIR_OPTIONS}
        value={sort.dir}
        onChange={(dir) => onSortChange({ ...sort, dir })}
      />

      {isNonDefault && (
        <button
          type="button"
          onClick={clearAll}
          className="text-[13px] text-ink-3 hover:text-ink-2 px-2 py-1.5"
        >
          Clear all
        </button>
      )}

      {hasActiveFilter && filteredCount < totalCount && (
        <span className="text-[12px] text-ink-4 ml-1">
          {filteredCount} of {totalCount} results
        </span>
      )}
    </div>
  );
}
