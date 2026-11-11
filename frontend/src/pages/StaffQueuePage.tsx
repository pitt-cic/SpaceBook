import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { RequestDetailModal } from '../components/staff/RequestDetailModal';
import { RequestFiltersBar, type QueueFilters } from '../components/staff/RequestFiltersBar';
import { RequestQueueTable } from '../components/staff/RequestQueueTable';
import { RequestStatsBar } from '../components/staff/RequestStatsBar';
import { StaffLayout } from '../components/StaffLayout';
import { useRooms } from '../hooks/useRooms';
import { useNow } from '../hooks/useNow';
import { useSiteRequests } from '../hooks/useSiteRequests';
import { isPastRequest } from '../lib/dates';

const EMPTY_FILTERS: QueueFilters = { status: '', room: '', type: '', showPast: false };

export default function StaffQueuePage() {
  const { site = '' } = useParams<{ site: string }>();
  const { data, isLoading, error } = useSiteRequests(site, {});
  const { data: roomsData } = useRooms(site);
  const [filters, setFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Outcome of the last approve/deny/counter-propose/cancellation action. The
  // detail modal closes on success, so it's announced from here (WCAG 4.1.3).
  const [announcement, setAnnouncement] = useState('');
  const now = useNow(60_000);

  const allRequests = data?.requests ?? [];
  const rooms = roomsData?.rooms ?? [];
  const pastIds = new Set(allRequests.filter((r) => isPastRequest(r, now)).map((r) => r.id));
  const filtered = allRequests.filter(
    (r) =>
      (filters.showPast || !pastIds.has(r.id)) &&
      (!filters.status || r.status === filters.status) &&
      (!filters.room || r.room === filters.room) &&
      (!filters.type || r.type === filters.type),
  );

  return (
    <StaffLayout activeNav="queue" site={site} title="Request Management">
      <RequestStatsBar requests={allRequests} />
      <RequestFiltersBar
        filters={filters}
        onChange={(next) => {
          setAnnouncement('');
          setFilters(next);
        }}
        rooms={rooms}
        pastCount={pastIds.size}
      />
      <p role="status" className="sr-only">
        {announcement || (!isLoading && !error ? `${filtered.length} requests shown` : '')}
      </p>
      {isLoading && <p className="text-sm text-ink-3">Loading requests…</p>}
      {error && (
        <p role="alert" className="text-sm text-err-fg">
          Couldn't load requests for this site.
        </p>
      )}
      {!isLoading && !error && (
        <RequestQueueTable
          requests={filtered}
          allRequests={allRequests}
          rooms={rooms}
          onView={(id) => {
            setAnnouncement('');
            setSelectedId(id);
          }}
        />
      )}
      {selectedId && (
        <RequestDetailModal
          id={selectedId}
          site={site}
          rooms={rooms}
          onClose={() => setSelectedId(null)}
          onResolved={setAnnouncement}
        />
      )}
    </StaffLayout>
  );
}
