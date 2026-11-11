import { useResendInvite } from '../../hooks/useResendInvite';
import type { BookingRequest } from '../../types/api';
import { Badge } from '../ui/Badge';

interface Props {
  request: BookingRequest;
  site: string;
}

// Last calendar-invite result for a booking (notify's calendarInvite record)
// plus a Resend action. Rendered only once a booking has been sent to the
// calendar (calendarSequence set), so deployments with invites off never see it.
export function CalendarInviteStatus({ request, site }: Props) {
  const resend = useResendInvite();
  const invite = request.calendarInvite;
  const canResend = ['approved', 'cancellation_requested', 'cancelled'].includes(request.status);

  return (
    <div className="mt-4 pt-4 border-t border-hairline flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-[11px] uppercase tracking-wide text-ink-4">Calendar invite</span>
      {!invite ? (
        <Badge variant="neutral">Queued</Badge>
      ) : invite.status === 'sent' ? (
        <Badge variant="success">{invite.method === 'CANCEL' ? 'Cancellation sent' : 'Sent'}</Badge>
      ) : (
        <Badge variant="error">Failed</Badge>
      )}
      {invite && (
        <span className="text-ink-3">
          update #{invite.sequence} · {new Date(invite.at).toLocaleString()}
        </span>
      )}
      {invite?.status === 'failed' && invite.error && (
        <span className="basis-full text-err-fg break-words">{invite.error}</span>
      )}
      {canResend && (
        <button
          type="button"
          disabled={resend.isPending}
          onClick={() => resend.mutate({ id: request.id, site })}
          className="ml-auto rounded-md border border-hairline-strong px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-2 disabled:opacity-40"
        >
          {resend.isPending ? 'Resending…' : resend.isSuccess ? 'Resent' : 'Resend invite'}
        </button>
      )}
      {resend.error && <span className="basis-full text-err-fg">{resend.error.message}</span>}
    </div>
  );
}
