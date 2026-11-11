import { useConfirmCancellation } from '../../hooks/useConfirmCancellation';
import { useRejectCancellation } from '../../hooks/useRejectCancellation';
import type { BookingRequest } from '../../types/api';

interface Props {
  request: BookingRequest;
  site: string;
  // Called after a successful action with a message to announce (the modal closes).
  onDone: (message: string) => void;
}

export function CancellationActions({ request, site, onDone }: Props) {
  const confirmCancellation = useConfirmCancellation();
  const rejectCancellation = useRejectCancellation();
  const mutating = confirmCancellation.isPending || rejectCancellation.isPending;
  const mutationError = confirmCancellation.error || rejectCancellation.error;

  return (
    <section
      aria-labelledby="cancellation-actions-heading"
      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex flex-col gap-2"
    >
      <h3 id="cancellation-actions-heading" className="sr-only">
        Cancellation request
      </h3>
      <p>{request.org} has requested to cancel this booking.</p>
      <div className="flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          disabled={mutating}
          onClick={() =>
            rejectCancellation.mutate(
              { id: request.id, site },
              { onSuccess: () => onDone(`Cancellation rejected. ${request.title} stays booked.`) },
            )
          }
          className="rounded-md border border-amber-700 text-amber-800 px-3 py-1.5 text-xs font-semibold hover:bg-amber-100 disabled:opacity-40"
        >
          Reject — Keep Booking
        </button>
        <button
          type="button"
          disabled={mutating}
          onClick={() =>
            confirmCancellation.mutate(
              { id: request.id, site },
              { onSuccess: () => onDone(`Cancellation confirmed. ${request.title} is cancelled.`) },
            )
          }
          className="rounded-md bg-warn-fg text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-900 disabled:opacity-40"
        >
          Confirm Cancellation
        </button>
      </div>
      {mutationError && (
        <p role="alert" className="text-err-fg">
          {mutationError.message}
        </p>
      )}
    </section>
  );
}
