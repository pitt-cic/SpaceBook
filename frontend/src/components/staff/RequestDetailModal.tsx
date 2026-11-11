import { useRequestDetail } from '../../hooks/useRequestDetail';
import { useSiteRequests } from '../../hooks/useSiteRequests';
import { reservedLabel } from '../../lib/availability';
import { findConflictingApproved, findRoomConflict, formatPreferences, preferredRooms } from '../../lib/conflicts';
import type { Room } from '../../types/api';
import { Button } from '../ui/Button';
import { StatusPill } from '../ui/StatusPill';
import { ApprovalActions } from './ApprovalActions';
import { CalendarInviteStatus } from './CalendarInviteStatus';
import { CancellationActions } from './CancellationActions';
import { ModalShell } from './ModalShell';

interface Props {
  id: string;
  site: string;
  rooms: Room[];
  onClose: () => void;
  // Called with an announcement after a decision succeeds (the modal then
  // closes); the page renders it in a live region.
  onResolved?: (message: string) => void;
}

// Grounded in GET /api/requests/{id} (staff-only detail route,
// backend/lambda/requests_staff/handler.py's get_request) — fetched fresh
// rather than reusing the queue table's cached list item, so approve/deny
// always act on the current status. The conflict check reuses the site's
// already-fetched request list (useSiteRequests dedupes against the queue
// page's own query) rather than a second network call.
export function RequestDetailModal({ id, site, rooms, onClose, onResolved }: Props) {
  const { data: request, isLoading } = useRequestDetail(id, site);
  const { data: siteData } = useSiteRequests(site, {});

  if (isLoading || !request) {
    return (
      <ModalShell title="Loading…" onClose={onClose}>
        <p role="status" className="text-sm text-ink-3">
          Loading request…
        </p>
      </ModalShell>
    );
  }

  // A pending request only conflicts when none of its preferred rooms is free —
  // staff can assign any free one on approve.
  const pending = request.status === 'pending_approval';
  const conflict = !siteData
    ? undefined
    : pending
      ? preferredRooms(request).every((id) => findRoomConflict(request, id, siteData.requests))
        ? findConflictingApproved(request, siteData.requests)
        : undefined
      : findConflictingApproved(request, siteData.requests);

  return (
    <ModalShell
      title={`${request.id} — ${request.title}`}
      onClose={onClose}
      footer={<Button variant="secondary" className="w-auto px-4 py-2" onClick={onClose}>Close</Button>}
    >
      <div className="flex items-center gap-2 mb-4">
        <StatusPill status={request.status} />
        <span className="font-mono text-[11.5px] text-ink-4">{request.id}</span>
        {conflict && (
          <span className="inline-flex items-center gap-0.5 rounded bg-warn-bg text-warn-fg font-semibold px-1.5 py-0.5 text-[11px]">
            <span aria-hidden="true">⚠</span> room conflict
          </span>
        )}
      </div>

      {conflict && (
        <div className="mb-4 rounded-xl bg-err-bg border border-red-200 p-3 text-sm text-err-fg">
          <strong>Conflict warning:</strong>{' '}
          {pending
            ? 'none of the requested rooms are free at this time. Assign another room or counter-propose.'
            : `this room is already approved for another event at this time — ${conflict.id}, ${conflict.title}, ${conflict.start}–${conflict.end}.`}
        </div>
      )}

      {(() => {
        const roomName = (rid: string) => rooms.find((r) => r.id === rid)?.name ?? rid;
        const preferences = preferredRooms(request);
        const requesterName = [request.firstname, request.lastname].filter(Boolean).join(' ');
        const core: Array<[string, string]> = [
          ['Organization', request.org],
          ['Event type', request.type],
          ['Activity type', request.activityType],
          ['Date', request.date],
          ['Time', `${request.start}–${request.end}`],
          ['Room reserved', reservedLabel(request)],
          // Pending: room is just the 1st choice, already listed under Requested rooms.
          ['Room', pending ? '' : roomName(request.room)],
          ['Attendance', String(request.attendance)],
          ['Minors involved', request.minors],
          // Always shown (with a "None" fallback): the requester picks these on
          // the form, but the default "None" is sent as undefined/stored null,
          // so an empty value means "no setup/cleanup buffer requested" — worth
          // stating explicitly rather than hiding the row.
          ['Setup time', request.setupTime || 'None'],
          ['Cleanup time', request.cleanupTime || 'None'],
          ['Facility rules', request.facilityRulesAccepted ? 'Accepted' : 'Not accepted'],
          ['Submitted', request.submittedAt.slice(0, 10)],
          ['Last updated', request.updatedAt ? request.updatedAt.slice(0, 10) : ''],
        ];
        const shown = core.filter(([, v]) => v != null && v !== '');

        return (
          <>
            <dl className="grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
              {shown.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-ink-4 mb-0.5">{k}</dt>
                  <dd className="text-[13px] font-medium text-ink">{v}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-[11px] text-ink-4 mb-0.5">Requested rooms</dt>
                <dd className="text-[13px] font-medium text-ink">{formatPreferences(preferences, roomName)}</dd>
              </div>
              {request.techNeeds?.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-ink-4 mb-1">Tech / equipment needs</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {request.techNeeds.map((t) => (
                      <span
                        key={t}
                        className="text-[12px] font-medium text-neu-fg bg-neu-bg rounded-full px-2 py-0.5"
                      >
                        {t}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              {request.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-ink-4 mb-0.5">Notes</dt>
                  <dd className="text-[13px] text-ink-2 whitespace-pre-wrap">{request.notes}</dd>
                </div>
              )}
            </dl>

            {/* Requester contact */}
            <div className="mt-4 pt-4 border-t border-hairline">
              <h3 className="text-[11px] uppercase tracking-wide text-ink-3 mb-2">Requester</h3>
              <dl className="grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
                {requesterName && (
                  <div>
                    <dt className="text-[11px] text-ink-4 mb-0.5">Name</dt>
                    <dd className="text-[13px] font-medium text-ink">{requesterName}</dd>
                  </div>
                )}
                {request.email && (
                  <div className="min-w-0">
                    <dt className="text-[11px] text-ink-4 mb-0.5">Email</dt>
                    <dd className="text-[13px] font-medium truncate">
                      <a className="text-primary-600 hover:underline" href={`mailto:${request.email}`}>
                        {request.email}
                      </a>
                    </dd>
                  </div>
                )}
                {request.phone && (
                  <div>
                    <dt className="text-[11px] text-ink-4 mb-0.5">Phone</dt>
                    <dd className="text-[13px] font-medium">
                      <a className="text-primary-600 hover:underline" href={`tel:${request.phone}`}>
                        {request.phone}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {request.seriesId && (
              <p className="mt-3 text-[12px] text-ink-3">
                <span aria-hidden="true">↻</span> Part of a recurring series ({request.seriesId}).
              </p>
            )}

            {request.status === 'denied' && request.denyReason && (
              <div className="mt-4 rounded-xl bg-err-bg border border-red-200 p-3 text-sm">
                <h3 className="text-[11px] uppercase tracking-wide text-err-fg mb-0.5">Denial reason</h3>
                <p className="text-[13px] text-ink-2 whitespace-pre-wrap">{request.denyReason}</p>
              </div>
            )}

            {request.counterProposal && (
              <div className="mt-4 rounded-xl bg-info-bg border border-primary-100 p-3">
                <h3 className="text-[11px] uppercase tracking-wide text-info-fg mb-1.5">
                  Counter-proposal sent
                </h3>
                <dl className="grid sm:grid-cols-2 gap-x-5 gap-y-2">
                  <div>
                    <dt className="text-[11px] text-ink-4 mb-0.5">Room</dt>
                    <dd className="text-[13px] font-medium text-ink">
                      {roomName(request.counterProposal.room)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-4 mb-0.5">Date</dt>
                    <dd className="text-[13px] font-medium text-ink">{request.counterProposal.date}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-4 mb-0.5">Time</dt>
                    <dd className="text-[13px] font-medium text-ink">
                      {request.counterProposal.start}–{request.counterProposal.end}
                    </dd>
                  </div>
                  {request.counterProposal.message && (
                    <div className="sm:col-span-2">
                      <dt className="text-[11px] text-ink-4 mb-0.5">Note to requestor</dt>
                      <dd className="text-[13px] text-ink-2 whitespace-pre-wrap">
                        {request.counterProposal.message}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
          </>
        );
      })()}

      {request.calendarSequence != null && <CalendarInviteStatus request={request} site={site} />}

      {request.status === 'pending_approval' && (
        <section aria-labelledby="request-decision-heading" className="mt-5 rounded-xl border border-primary-100 bg-primary-50 p-3.5">
          <h3 id="request-decision-heading" className="text-[12.5px] font-semibold text-primary-800 mb-3">
            Decision
          </h3>
          <ApprovalActions
            request={request}
            site={site}
            rooms={rooms}
            siteRequests={siteData?.requests ?? []}
            onDone={(message) => {
              onResolved?.(message);
              onClose();
            }}
          />
        </section>
      )}
      {request.status === 'cancellation_requested' && (
        <div className="mt-5">
          <CancellationActions
            request={request}
            site={site}
            onDone={(message) => {
              onResolved?.(message);
              onClose();
            }}
          />
        </div>
      )}
      {request.status !== 'pending_approval' && request.status !== 'cancellation_requested' && (
        <p className="text-xs text-ink-4 mt-5">No further action available for this status.</p>
      )}
    </ModalShell>
  );
}
