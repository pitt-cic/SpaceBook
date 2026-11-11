import type { BookingRequest, RequestStatus } from '../../types/api';

const STAT_STATUSES: { status: RequestStatus; label: string; color: string }[] = [
  { status: 'pending_approval', label: 'Pending', color: 'text-warn-fg' },
  { status: 'counter_proposed', label: 'Counter-proposed', color: 'text-info-fg' },
  { status: 'approved', label: 'Approved', color: 'text-ok-fg' },
  { status: 'denied', label: 'Denied', color: 'text-err-fg' },
  { status: 'cancellation_requested', label: 'Cancel Req.', color: 'text-ink-2' },
  { status: 'cancelled', label: 'Cancelled', color: 'text-ink-4' },
];

// A <dl> so each count is read with its status ("Pending, 3"); the color is
// decorative — the label carries the meaning.
export function RequestStatsBar({ requests }: { requests: BookingRequest[] }) {
  return (
    <dl aria-label="Request counts by status" className="grid grid-cols-2 min-[400px]:grid-cols-3 sm:grid-cols-6 gap-3">
      {STAT_STATUSES.map(({ status, label, color }) => (
        <div key={status} className="rounded-xl border border-hairline bg-surface px-3 py-2.5">
          <dt className="text-[11px] text-ink-3">
            {status === 'cancellation_requested' ? (
              <>
                <span aria-hidden="true">{label}</span>
                <span className="sr-only">Cancellation requested</span>
              </>
            ) : (
              label
            )}
          </dt>
          <dd className={`text-xl font-bold mt-1 ${color}`}>{requests.filter((r) => r.status === status).length}</dd>
        </div>
      ))}
    </dl>
  );
}
