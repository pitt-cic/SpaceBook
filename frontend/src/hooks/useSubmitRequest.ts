import { useMutation } from '@tanstack/react-query';
import { submitRequest } from '../api/requestsPublic';
import type { SubmitRequestInput } from '../types/api';

export function useSubmitRequest() {
  return useMutation({
    mutationFn: (input: SubmitRequestInput) => submitRequest(input),
  });
}
