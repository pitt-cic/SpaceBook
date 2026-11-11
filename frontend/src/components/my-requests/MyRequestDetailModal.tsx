import { useEffect, useRef, useState } from 'react';
import { reservedLabel } from '../../lib/availability';
import { formatPreferences, preferredRooms } from '../../lib/conflicts';
import type { BookingRequest } from '../../types/api';
import { Button } from '../ui/Button';
import { ModalShell } from '../staff/ModalShell';
import { StatusPill } from '../ui/StatusPill';
import { CounterProposalPanel } from './CounterProposalPanel';

interface Props {
  request: BookingRequest;
  roomName: (id: string) => string;
  onClose: () => void;
  onCancel: () => void;
  isCancelling: boolean;
  cancelError: Error | null;
  onAcceptCounterProposal: () => void;
  onDeclineCounterProposal: () => void;
  isRespondingToProposal: boolean;
  proposalError: Error | null;
}

// Full requestor-facing detail for one of their own submissions. All fields
// come from useMyRequests' already-fetched BookingRequest (no extra network
// call), and the same status-scoped actions the card used to inline
// (cancellation, counter-proposal accept/decline) live here now that the card
// is just a summary that opens this modal.
export function MyRequestDetailModal({
  request,
  roomName,
  onClose,
  onCancel,
  isCancelling,
  cancelError,
  onAcceptCounterProposal,
  onDeclineCounterProposal,
  isRespondingToProposal,
  proposalError,
}: Props) {
  const isRecurring = Boolean(request.seriesId);
  const preferences = preferredRooms(request);
  // Until approved, request.room is only the 1st choice; staff assign the room.
  const assigned = request.status === 'approved' || request.status === 'cancellation_requested';
  const awaitingRoom = request.status === 'pending_approval' || request.status === 'counter_proposed';
  // A pending request is cancelled outright (nothing is booked yet), so it gets
  // an inline confirm step; an approved one only files a request staff confirm.
  const isPending = request.status === 'pending_approval';
  const canCancel = isPending || request.status === 'approved';
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // The footer's buttons are swapped out (confirm step) or removed (after a
  // cancel / counter-proposal response changes the status), which would drop
  // keyboard focus onto <body>. Put it back on the footer's first button so
  // keyboard and screen-reader users stay inside the dialog (WCAG 2.4.3).
  const footerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    footerRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [confirmingCancel, request.status, isCancelling, isRespondingToProposal]);

  // Announce a status change made from inside this dialog (e.g. "Cancelled").
  const initialStatus = useRef(request.status);
  const statusChanged = request.status !== initialStatus.current;

  const core: Array<[string, string]> = [
    ['Organization', request.org],
    ['Event type', request.type],
    ['Activity type', request.activityType],
    ['Date', request.date],
    ['Time', `${request.start}–${request.end}`],
    ['Room reserved', reservedLabel(request)],
    ['Room', assigned ? roomName(request.room) : awaitingRoom ? 'Assigned by staff on approval' : ''],
    ['Attendance', `${request.attendance} attendees`],
    ['Minors involved', request.minors],
    ['Setup time', request.setupTime || 'None'],
    ['Cleanup time', request.cleanupTime || 'None'],
    ['Submitted', request.submittedAt.slice(0, 10)],
    ['Last updated', request.updatedAt ? request.updatedAt.slice(0, 10) : ''],
  ];
  const shown = core.filter(([, v]) => v != null && v !== '');

  return (
    <ModalShell
      title={request.title}
      onClose={onClose}
      footer={
        <div ref={footerRef} className="contents">
          {canCancel && confirmingCancel ? (
            <>
              <Button
                variant="secondary"
                className="w-auto px-4 py-2"
                onClick={() => setConfirmingCancel(false)}
                disabled={isCancelling}
              >
                Keep Request
              </Button>
              <Button
                variant="outline"
                className="w-auto px-4 py-2 border-err-fg text-err-fg hover:bg-red-50"
                onClick={onCancel}
                isLoading={isCancelling}
              >
                Yes, Cancel Request
              </Button>
            </>
          ) : (
            <>
              {canCancel && (
                <Button
                  variant="outline"
                  className="w-auto px-4 py-2 border-err-fg text-err-fg hover:bg-red-50"
                  onClick={isPending ? () => setConfirmingCancel(true) : onCancel}
                  isLoading={isCancelling}
                >
                  {isPending ? 'Cancel Request' : 'Request Cancellation'}
                </Button>
              )}
              <Button variant="secondary" className="w-auto px-4 py-2" onClick={onClose}>
                Close
              </Button>
            </>
          )}
        </div>
      }
    >
      <p role="status" className="sr-only">
        {statusChanged && (
          <>
            Request status updated: <StatusPill status={request.status} />
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StatusPill status={request.status} />
        <span className="font-mono text-[11.5px] text-ink-4">{request.id}</span>
      </div>

      {request.status === 'counter_proposed' && request.counterProposal && (
        <div className="mb-4">
          <CounterProposalPanel
            request={request}
            onAccept={onAcceptCounterProposal}
            onDecline={onDeclineCounterProposal}
            isSubmitting={isRespondingToProposal}
          />
          {proposalError && (
            <p role="alert" className="mt-2 rounded-lg bg-err-bg border border-red-200 p-2 text-[12px] text-err-fg">
              {proposalError.message || 'Something went wrong. Please try again.'}
            </p>
          )}
        </div>
      )}

      {request.status === 'denied' && request.denyReason && (
        <div className="mb-4 rounded-xl bg-err-bg border border-red-200 p-3 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-err-fg mb-0.5">Denial reason</p>
          <p className="text-[13px] text-ink-2 whitespace-pre-wrap">{request.denyReason}</p>
        </div>
      )}

      {canCancel && confirmingCancel && (
        <div role="alert" className="mb-4 rounded-xl bg-err-bg border border-red-200 p-3 text-[13px] text-err-fg">
          Cancel this request? It hasn't been reviewed yet, so it will be withdrawn immediately. This
          can't be undone.
        </div>
      )}

      {request.status === 'cancellation_requested' && (
        <div className="mb-4 rounded-xl bg-warn-bg border border-amber-200 p-3 text-[13px] text-warn-fg">
          Cancellation requested — pending staff confirmation.
        </div>
      )}

      <dl className="grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
        {shown.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] text-ink-4 mb-0.5">{k}</dt>
            <dd className="text-[13px] font-medium text-ink">{v}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-[11px] text-ink-4 mb-0.5">Your preferred rooms</dt>
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

      {isRecurring && (
        <p className="mt-3 text-[12px] text-ink-3">
          <span aria-hidden="true">↻ </span>Part of a recurring series ({request.seriesId}).
        </p>
      )}

      {canCancel && cancelError && (
        <p role="alert" className="mt-4 rounded-lg bg-err-bg border border-red-200 p-2 text-[12px] text-err-fg">
          {cancelError.message || 'Could not request cancellation. Please try again.'}
        </p>
      )}
    </ModalShell>
  );
}
