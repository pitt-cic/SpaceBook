import { useQueries } from '@tanstack/react-query';
import { getAvailability } from '../api/requestsPublic';
import type { AvailabilityBooking } from '../types/api';

// One request per visible grid day (up to ~42) since the backend availability route only
// accepts a single `date`, not a range. useQueries caches/dedupes by queryKey so switching
// weeks within an already-viewed month, or toggling back to week view, doesn't re-fetch.
export function useMonthAvailability(site: string, dates: string[]) {
  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ['availability', site, date],
      queryFn: () => getAvailability(site, date),
      enabled: Boolean(site && date),
    })),
  });

  const bookingsByDate = new Map<string, AvailabilityBooking[]>();
  const loadingByDate = new Map<string, boolean>();
  dates.forEach((date, i) => {
    bookingsByDate.set(date, results[i]?.data?.bookings ?? []);
    loadingByDate.set(date, results[i]?.isLoading ?? false);
  });

  return { bookingsByDate, loadingByDate };
}
