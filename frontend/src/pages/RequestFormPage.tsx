import { Link, useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/a11y/PublicLayout';
import { RequestForm } from '../components/request-form/RequestForm';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSites } from '../hooks/useSites';
import { useSubmitRequest } from '../hooks/useSubmitRequest';
import type { SubmitRequestInput } from '../types/api';
import type { RequestFormState } from '../types/requestForm';

export default function RequestFormPage() {
  const navigate = useNavigate();
  const { data: sitesData, isLoading: sitesLoading } = useSites();
  const submitRequest = useSubmitRequest();
  useDocumentTitle('Request a space');

  const activeSites = (sitesData?.sites ?? []).filter((s) => s.active);

  async function handleSubmit(input: SubmitRequestInput, form: RequestFormState, roomLabel: string) {
    try {
      const result = await submitRequest.mutateAsync(input);
      navigate('/request/confirmation', { state: { form, result, roomLabel } });
    } catch {
      // Surfaced via submitRequest.error below.
    }
  }

  return (
    <PublicLayout
      className="px-4 pt-8"
      header={
        <div className="max-w-2xl mx-auto flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span
              className="w-7 h-7 rounded-lg bg-primary-900 text-accent font-extrabold flex items-center justify-center text-sm"
              aria-hidden="true"
            >
              S
            </span>
            <span className="text-sm font-semibold text-ink-2">SpaceBook</span>
          </div>
          <nav aria-label="Requestor">
            <Link to="/my-requests" className="text-sm font-medium text-primary-600 hover:underline">
              My Requests
            </Link>
          </nav>
        </div>
      }
      mainClassName="w-full max-w-2xl mx-auto flex flex-col gap-4"
    >
      <div>
        <h1 className="text-2xl font-bold text-ink">Request a space</h1>
        <p className="text-sm text-ink-3 mt-1">
          Rooms are available Monday–Friday, 9 AM–5 PM. We'll email you once staff review your request.
        </p>
      </div>

      <RequestForm
        sites={activeSites}
        sitesLoading={sitesLoading}
        submitLabel="Submit request"
        isSubmitting={submitRequest.isPending}
        submitError={submitRequest.error?.message}
        onSubmit={handleSubmit}
      />
    </PublicLayout>
  );
}
