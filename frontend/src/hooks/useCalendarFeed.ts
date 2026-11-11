import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCalendarToken, resetCalendarToken } from '../api/calendarFeed';
import { useAuth } from './useAuth';

export function useCalendarToken() {
  const { idToken, getIdToken } = useAuth();
  return useQuery({
    queryKey: ['calendarToken'],
    queryFn: async () => getCalendarToken(await getIdToken()),
    enabled: Boolean(idToken),
  });
}

export function useResetCalendarToken() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => resetCalendarToken(await getIdToken()),
    onSuccess: (data) => {
      queryClient.setQueryData(['calendarToken'], data);
    },
  });
}
