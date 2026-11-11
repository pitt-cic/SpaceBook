import type { ReactNode } from 'react';
import { useId } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { CloseIcon } from '../icons';

interface Props {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

// Every request-detail/room-edit/site-edit modal in the app renders through
// here, so the header/footer fix applies once and shows up everywhere
// (report finding 5 / decision 3) — pass a title and put action buttons in
// `footer` rather than as the last thing in `children`.
//
// It's a real modal dialog for assistive tech: role="dialog" + aria-modal,
// named by its title, with useDialog's focus trap / Escape / focus return.
export function ModalShell({ title, children, footer, onClose }: Props) {
  const titleId = useId();
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="fixed inset-0 bg-ink/30 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-surface rounded-2xl border border-hairline-strong shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-hairline shrink-0">
          <h2 id={titleId} className="min-w-0 text-lg font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-hairline text-ink-3 hover:text-ink hover:bg-canvas"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-3 bg-surface-2 border-t border-hairline flex flex-wrap justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
