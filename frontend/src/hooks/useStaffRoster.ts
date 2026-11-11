import { useQuery } from '@tanstack/react-query';
import { listStaff } from '../api/staffAdmin';
import { useAuth } from './useAuth';

export function useStaffRoster() {
  const { idToken, getIdToken } = useAuth();
  return useQuery({
    queryKey: ['staffRoster'],
    queryFn: async () => listStaff(await getIdToken()),
    enabled: Boolean(idToken),
  });
}
