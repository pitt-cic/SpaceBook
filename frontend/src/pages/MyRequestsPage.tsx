import { useQueries } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRooms } from '../api/rooms';
import { MyRequestCard } from '../components/my-requests/MyRequestCard';
import { MyRequestDetailModal } from '../components/my-requests/MyRequestDetailModal';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  MyRequestsFiltersBar,
  type MyRequestsFilters,
  type MyRequestsSort,
} from '../components/my-requests/MyRequestsFiltersBar';
import { RequestorOtpGate } from '../components/my-requests/RequestorOtpGate';
import { PublicLayout } from '../components/a11y/PublicLayout';
import { useAcceptCounterProposal } from '../hooks/useAcceptCounterProposal';
import { useCancelRequest } from '../hooks/useCancelRequest';
import { useDeclineCounterProposal } from '../hooks/useDeclineCounterProposal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMyRequests } from '../hooks/useMyRequests';
import { useNow } from '../hooks/useNow';
import { useRequestorAuth } from '../hooks/useRequestorAuth';
import { isPastRequest } from '../lib/dates';
import type { Room } from '../types/api';

// Module-level so useQueries' combine keeps a stable reference; its plain-object
// result is structurally shared, so roomName below only changes with the data.
function combineRoomNames(results: { data?: { rooms: Room[] } }[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const result of results) {
    for (const room of result.data?.rooms ?? []) names[room.id] = room.name;
  }
  return names;
}

export default function MyRequestsPage() {
  const { isAuthenticated, email, logout } = useRequestorAuth();
  const { data, isLoading, error } = useMyRequests();
  const cancelRequest = useCancelRequest();
  const acceptCounterProposal = useAcceptCounterProposal();
  const declineCounterProposal = useDeclineCounterProposal();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<MyRequestsFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<MyRequestsSort>(DEFAULT_SORT);
  const now = useNow(60_000);
  useDocumentTitle(isAuthenticated ? 'My Requests' : 'Sign in to My Requests');

  const requests = useMemo(() => data?.requests ?? [], [data]);
  const pastIds = useMemo(() => new Set(requests.filter((r) => isPastRequest(r, now)).map((r) => r.id)), [requests, now]);

  // Resolve room ids → display names across every site the requestor has
  // requests at. Same query keys as useRooms (and DashboardPage), so these
  // dedupe with any other rooms fetch. An id not (yet) loaded shows as-is.
  const siteIds = useMemo(() => [...new Set(requests.map((r) => r.site))], [requests]);
  const roomNamesById = useQueries({
    queries: siteIds.map((site) => ({
      queryKey: ['rooms', site],
      queryFn: () => listRooms(site),
      staleTime: 5 * 60 * 1000,
      enabled: isAuthenticated && Boolean(site),
    })),
    combine: combineRoomNames,
  });
  const roomName = useMemo(
    () => (id: string): string => roomNamesById[id] ?? id,
    [roomNamesById],
  );

  const displayedRequests = useMemo(() => {
    let result = filters.showPast ? requests : requests.filter((r) => !pastIds.has(r.id));
    if (filters.status) result = result.filter((r) => r.status === filters.status);
    if (filters.type) result = result.filter((r) => r.type === filters.type);
    if (filters.recurring === 'yes') result = result.filter((r) => Boolean(r.seriesId));
    if (filters.recurring === 'no') result = result.filter((r) => !r.seriesId);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (r) => r.title.toLowerCase().includes(q) || r.org.toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sort.field === 'date' || sort.field === 'submittedAt') {
        cmp = a[sort.field] < b[sort.field] ? -1 : a[sort.field] > b[sort.field] ? 1 : 0;
      } else {
        cmp = a[sort.field].localeCompare(b[sort.field]);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [requests, pastIds, filters, sort]);

  if (!isAuthenticated) {
    return <RequestorOtpGate />;
  }

  const actionNeeded = requests.filter((r) => r.status === 'counter_proposed' && !pastIds.has(r.id));
  const selected = requests.find((r) => r.id === selectedId) ?? null;

  // Clear any stale mutation error/pending state so it never bleeds from one
  // request's modal into another's (all three mutations are shared instances).
  const openRequest = (id: string) => {
    cancelRequest.reset();
    acceptCounterProposal.reset();
    declineCounterProposal.reset();
    setSelectedId(id);
  };
  const closeModal = () => {
    cancelRequest.reset();
    acceptCounterProposal.reset();
    declineCounterProposal.reset();
    setSelectedId(null);
  };

  return (
    <PublicLayout
      header={
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b border-hairline bg-surface">
          <h1 className="font-semibold text-ink">My Requests</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/"
              className="text-sm font-medium text-white bg-primary-900 hover:bg-primary-800 px-3 py-1.5 rounded-lg"
            >
              <span aria-hidden="true">+ </span>Request a room
            </Link>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
              <span className="break-all">
                <span className="sr-only">Signed in as </span>
                {email}
              </span>
              <button type="button" onClick={logout} className="text-primary-600 hover:underline py-1">
                Sign out
              </button>
            </div>
          </div>
        </div>
      }
    >
      <div className="p-4 sm:p-6 flex flex-col gap-4 max-w-6xl mx-auto">
        {actionNeeded.length > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800">
            <span aria-hidden="true">⚠️ </span>
            <strong>Action Required:</strong> You have {actionNeeded.length} request
            {actionNeeded.length > 1 ? 's' : ''} awaiting your response to a counter-proposal.
          </div>
        )}

        {requests.length > 0 && (
          <MyRequestsFiltersBar
            filters={filters}
            onFiltersChange={setFilters}
            sort={sort}
            onSortChange={setSort}
            totalCount={requests.length}
            filteredCount={displayedRequests.length}
            pastCount={pastIds.size}
          />
        )}

        {/* Announces how many cards are showing whenever filters/sort change
            (WCAG 4.1.3) — the grid itself updates silently. */}
        <p role="status" className="sr-only">
          {!isLoading && requests.length > 0
            ? `Showing ${displayedRequests.length} of ${requests.length} ${requests.length === 1 ? 'request' : 'requests'}`
            : ''}
        </p>

        {isLoading && (
          <p role="status" className="text-sm text-ink-3">
            Loading your requests…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-err-fg">
            Couldn't load your requests. Try refreshing.
          </p>
        )}
        {!isLoading && requests.length === 0 && (
          <p className="text-sm text-ink-3">
            No requests found for this email.{' '}
            <Link to="/" className="text-primary-600 underline hover:text-primary-700">
              Submit a new request
            </Link>
            .
          </p>
        )}

        {!isLoading && requests.length > 0 && displayedRequests.length === 0 && (
          <p className="text-sm text-ink-3">
            {!filters.showPast && pastIds.size === requests.length ? (
              <>
                You have no upcoming requests.{' '}
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, showPast: true })}
                  className="text-primary-600 underline hover:text-primary-700"
                >
                  Show {pastIds.size} past {pastIds.size === 1 ? 'request' : 'requests'}
                </button>
              </>
            ) : (
              'No requests match your filters.'
            )}
          </p>
        )}

        {displayedRequests.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Your requests">
            {displayedRequests.map((request) => (
              <li key={request.id} className="min-w-0">
                <MyRequestCard
                  request={request}
                  roomName={roomName}
                  onOpen={() => openRequest(request.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <MyRequestDetailModal
          request={selected}
          roomName={roomName}
          onClose={closeModal}
          onCancel={() => cancelRequest.mutate(selected.id)}
          isCancelling={cancelRequest.isPending && cancelRequest.variables === selected.id}
          cancelError={cancelRequest.error as Error | null}
          onAcceptCounterProposal={() => acceptCounterProposal.mutate(selected.id)}
          onDeclineCounterProposal={() => declineCounterProposal.mutate(selected.id)}
          isRespondingToProposal={acceptCounterProposal.isPending || declineCounterProposal.isPending}
          proposalError={(acceptCounterProposal.error || declineCounterProposal.error) as Error | null}
        />
      )}
    </PublicLayout>
  );
}
