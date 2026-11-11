import { useMutation, useQueryClient } from '@tanstack/react-query';
import { checkIn, markNoShow, undoCheckin } from '../api/requestsStaff';
import { useAuth } from './useAuth';

export function useCheckIn() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => checkIn(id, await getIdToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
    },
  });
}

export function useMarkNoShow() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => markNoShow(id, await getIdToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
    },
  });
}

export function useUndoCheckin() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => undoCheckin(id, await getIdToken()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['siteRequests'] });
    },
  });
}
