import { useLocation, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/a11y/PublicLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { reservedLabel } from '../lib/availability';
import type { SubmitRequestResponse } from '../types/api';
import type { RequestFormState } from '../types/requestForm';

interface ConfirmationState {
  form: RequestFormState;
  result: SubmitRequestResponse;
  roomLabel: string;
}

export default function RequestConfirmationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ConfirmationState | null;
  useDocumentTitle(state ? 'Request submitted' : 'No request to confirm');

  if (!state) {
    return (
      <PublicLayout className="px-4 pt-8" mainClassName="flex items-center justify-center">
        <Card className="max-w-md text-center">
          <h1 className="text-ink-3 text-base font-normal">No request to confirm.</h1>
          <div className="mt-4">
            <Button onClick={() => navigate('/')}>Submit a Request</Button>
          </div>
        </Card>
      </PublicLayout>
    );
  }

  const { form, result, roomLabel } = state;

  return (
    <PublicLayout className="px-4 pt-8" mainClassName="flex items-center justify-center">
      <div className="w-full max-w-md flex flex-col items-center gap-3 text-center">
        <div
          className="w-14 h-14 rounded-full bg-ok-bg text-ok-fg flex items-center justify-center text-3xl"
          aria-hidden="true"
        >
          ✓
        </div>
        <h1 className="text-xl font-bold text-ink">Request Submitted!</h1>
        <p className="text-sm text-ink-3">
          Request ID <span className="font-mono bg-neu-bg rounded px-2 py-0.5">{result.id}</span> · Estimated
          response time: 2–3 business days
        </p>
        <Card className="w-full text-left text-sm">
          <h2 className="sr-only">Request details</h2>
          <p>
            <strong>Contact:</strong> {form.firstname} {form.lastname}
          </p>
          <p>
            <strong>Organization:</strong> {form.org}
          </p>
          <p>
            <strong>Event:</strong> {form.title}
          </p>
          <p>
            <strong>{form.altRoom1 ? 'Preferred rooms' : 'Room'}:</strong> {roomLabel}
          </p>
          <p>
            <strong>Date:</strong> {form.date} · {form.start}–{form.end}
          </p>
          {reservedLabel(form) && (
            <p>
              <strong>Room reserved:</strong> {reservedLabel(form)}
            </p>
          )}
          <p>
            <strong>Attendance:</strong> {form.attendance}
          </p>
          {form.techNeeds.length > 0 && (
            <p>
              <strong>Technology:</strong> {form.techNeeds.join(', ')}
            </p>
          )}
          {result.seriesId && (
            <p>
              <strong>Recurring series:</strong> {result.occurrences.length} occurrences scheduled
            </p>
          )}
        </Card>
        <p className="text-xs text-ink-4">
          A confirmation email has been sent to {form.email} with a link to manage this request.
        </p>
        <div className="flex gap-2 w-full">
          <div className="flex-1">
            <Button variant="secondary" onClick={() => navigate('/')}>
              Submit Another Request
            </Button>
          </div>
          <div className="flex-1">
            <Button onClick={() => navigate('/my-requests')}>Manage My Requests</Button>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
