import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

// Open dialogs, innermost last — only the top one handles Escape/Tab, so a
// dialog opened from inside another (e.g. room photos over a room editor)
// doesn't close both.
const openDialogs: HTMLElement[] = [];

function focusableIn(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => !n.closest('[inert]') && n.getClientRects().length > 0,
  );
}

/**
 * Modal-dialog keyboard behaviour (WAI-ARIA APG dialog pattern): on open,
 * focus moves into the dialog; Tab/Shift+Tab cycle inside it; Escape calls
 * onClose; on close, focus returns to whatever opened it. Attach the returned
 * ref to the element with role="dialog".
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Captured once at first render, before focus moves into the dialog — an
  // effect would see the dialog's own control after StrictMode's re-mount.
  const openerRef = useRef<HTMLElement | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = document.activeElement as HTMLElement | null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = openerRef.current;
    openDialogs.push(dialog);

    // Focus the dialog itself (it needs tabIndex={-1}) so a screen reader
    // announces its title before the user Tabs into the content; mark a field
    // with data-autofocus to start there instead.
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialog || !dialog) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return ref;
}
