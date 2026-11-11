import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RequestForm } from '../components/request-form/RequestForm';
import { StaffLayout } from '../components/StaffLayout';
import { useCreateBooking } from '../hooks/useCreateBooking';
import { useSites } from '../hooks/useSites';
import type { SubmitRequestInput } from '../types/api';

interface Booked {
  site: string;
  title: string;
  roomLabel: string;
  occurrences: number;
}

// Staff-side "New Booking": the public request form, locked to the sidebar's
// current site, offering hidden (staff-only) rooms too. Bookings made here are
// approved on creation (requests_staff.create_booking).
export default function StaffBookingPage() {
  const { site = '' } = useParams<{ site: string }>();
  const { data: sitesData, isLoading: sitesLoading } = useSites();
  const createBooking = useCreateBooking();
  const [booked, setBooked] = useState<Booked | null>(null);
  // Bumped after a successful booking to remount the form with blank fields.
  const [formKey, setFormKey] = useState(0);
  const bannerRef = useRef<HTMLDivElement>(null);

  // The form is long and remounts blank after a booking (so the Create
  // button that had focus is gone): move focus to the confirmation, which
  // scrolls it into view and has screen readers read it (WCAG 2.4.3 / 4.1.3).
  useEffect(() => {
    if (booked) bannerRef.current?.focus();
  }, [booked]);

  const matchedSite = sitesData?.sites.find((s) => s.id === site);
  const sites = matchedSite ? [matchedSite] : [];

  async function handleSubmit(input: SubmitRequestInput, _form: unknown, roomLabel: string) {
    setBooked(null);
    try {
      const result = await createBooking.mutateAsync({ site, input });
      setBooked({ site, title: input.title, roomLabel, occurrences: result.occurrences.length });
      createBooking.reset();
      setFormKey((k) => k + 1);
    } catch {
      // Surfaced via createBooking.error below.
    }
  }

  return (
    <StaffLayout
      activeNav="book"
      site={site}
      siteLabel={matchedSite?.label}
      siteColor={matchedSite?.color}
      title="New Booking"
    >
      <div className="max-w-2xl w-full mx-auto flex flex-col gap-4">
        <p className="text-sm text-ink-3">
          Book a room on someone's behalf. Staff bookings are approved immediately, and rooms marked staff only are
          available here.
        </p>

        {booked?.site === site && (
          <div
            ref={bannerRef}
            tabIndex={-1}
            className="p-3 rounded-xl bg-ok-bg border border-hairline flex flex-wrap items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ok-fg"
          >
            <p className="text-sm text-ok-fg flex-1 min-w-0">
              Booked <span className="font-semibold">{booked.title}</span> in {booked.roomLabel}
              {booked.occurrences > 1 ? ` (${booked.occurrences} dates)` : ''}.
            </p>
            <Link to={`/staff/${site}/calendar`} className="text-sm font-medium text-primary-600 hover:underline">
              View in Room Availability <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}

        <RequestForm
          key={`${site}-${formKey}`}
          staff
          sites={sites}
          sitesLoading={sitesLoading}
          submitLabel="Create booking"
          isSubmitting={createBooking.isPending}
          submitError={createBooking.error?.message}
          onSubmit={handleSubmit}
        />
      </div>
    </StaffLayout>
  );
}
