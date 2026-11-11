import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useSitesSummary } from './useSitesSummary';

interface OperatingSiteContextType {
  operatingSite: string;
  setOperatingSite: (site: string) => void;
  // The signed-in account's own accessible site ids (every active site for
  // admin, or just this account's staff-<site>/checkin-<site> groups
  // otherwise) — backs StaffLayout's site switcher.
  accountSiteIds: string[];
}

const OperatingSiteContext = createContext<OperatingSiteContextType | undefined>(undefined);

// The one other app-wide context besides useAuth(). Tracks which site the
// staff shell's scoped pages (Room Availability, Manage Requests, …) currently
// act on — for every role, not just admin, since any multi-site staff account
// can switch sites from StaffLayout's sidebar site switcher.
export function OperatingSiteProvider({ children }: { children: ReactNode }) {
  const { data } = useSitesSummary();
  const accountSiteIds = Object.keys(data?.sites ?? {});
  const [operatingSite, setOperatingSite] = useState<string>('');

  // Initializes once the account's site list is known. Does NOT validate
  // that operatingSite is in accountSiteIds — admin pages can legitimately
  // navigate to sites outside the user's own staff-<site>/checkin-<site>
  // groups (e.g. Manage Rooms for any site), and StaffLayout's URL-sync
  // effect must win in that case without triggering an infinite loop.
  useEffect(() => {
    if (accountSiteIds.length === 0) return;
    if (!operatingSite) {
      setOperatingSite(accountSiteIds[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountSiteIds.join(','), operatingSite]);

  return (
    <OperatingSiteContext.Provider value={{ operatingSite, setOperatingSite, accountSiteIds }}>
      {children}
    </OperatingSiteContext.Provider>
  );
}

export function useOperatingSite() {
  const context = useContext(OperatingSiteContext);
  if (context === undefined) {
    throw new Error('useOperatingSite must be used within an OperatingSiteProvider');
  }
  return context;
}
