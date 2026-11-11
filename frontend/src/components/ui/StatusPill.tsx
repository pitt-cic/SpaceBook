import type { RequestStatus } from '../../types/api';
import { Badge } from './Badge';

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  denied: 'Denied',
  counter_proposed: 'Counter-Proposed',
  cancellation_requested: 'Cancellation Requested',
  cancelled: 'Cancelled',
};

const STATUS_VARIANTS: Record<RequestStatus, 'neutral' | 'success' | 'warning' | 'error' | 'info'> = {
  pending_approval: 'warning',
  approved: 'success',
  denied: 'error',
  counter_proposed: 'info',
  cancellation_requested: 'warning',
  cancelled: 'neutral',
};

export function StatusPill({ status }: { status: RequestStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
