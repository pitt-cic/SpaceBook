import type { BookingRequest } from '../../types/api';

interface Props {
  request: BookingRequest;
  onAccept: () => void;
  onDecline: () => void;
  isSubmitting: boolean;
}

export function CounterProposalPanel({ request, onAccept, onDecline, isSubmitting }: Props) {
  const proposal = request.counterProposal;
  if (!proposal) return null;

  return (
    <section aria-labelledby="counter-proposal-heading" className="rounded-xl border-2 border-primary-600 bg-surface p-4">
      <h3 id="counter-proposal-heading" className="font-bold text-sm text-ink">
        Review Counter-Proposal — {request.title}
      </h3>
      <div className="text-sm mt-2 space-y-1 text-ink-2">
        {proposal.room !== request.room && (
          <p>
            <strong>Proposed Room:</strong> {proposal.room}{' '}
            <span className="text-xs text-ink-4">(changed from {request.room})</span>
          </p>
        )}
        {proposal.date !== request.date && (
          <p>
            <strong>Proposed Date:</strong> {proposal.date}{' '}
            <span className="text-xs text-ink-4">(changed from {request.date})</span>
          </p>
        )}
        {(proposal.start !== request.start || proposal.end !== request.end) && (
          <p>
            <strong>Proposed Time:</strong> {proposal.start}–{proposal.end}{' '}
            <span className="text-xs text-ink-4">
              (changed from {request.start}–{request.end})
            </span>
          </p>
        )}
      </div>
      {proposal.message && (
        <div className="mt-2 rounded-lg bg-surface-2 border border-hairline p-2 text-xs text-ink-3">
          <strong>Staff note:</strong> "{proposal.message}"
        </div>
      )}
      <div className="flex flex-wrap gap-2 justify-end mt-3">
        <button
          type="button"
          onClick={onDecline}
          disabled={isSubmitting}
          className="rounded-md border border-err-fg text-err-fg px-3 py-1.5 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
        >
          <span aria-hidden="true">✕ </span>Decline Changes
        </button>
        {/* ok-fg rather than green-600: white on green-600 is only 3.3:1. */}
        <button
          type="button"
          onClick={onAccept}
          disabled={isSubmitting}
          className="rounded-md bg-ok-fg text-white px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
        >
          <span aria-hidden="true">✓ </span>Accept Changes
        </button>
      </div>
    </section>
  );
}
