import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * WAI-ARIA APG "menu button" behaviour for a button that toggles a
 * role="menu" popup: opening focuses the first item; ArrowUp/ArrowDown/Home/
 * End move between items; Escape closes and returns focus to the button; Tab
 * or a click outside closes. Spread `buttonProps` on the trigger, put
 * `containerRef` on an element wrapping both, and `menuProps` on the menu.
 * Give each item role="menuitem" (or menuitemradio) and tabIndex={-1}: focus
 * moves between items with the arrow keys, and Tab leaves the menu.
 */
export function useMenuButton() {
  const [open, setOpen] = useState(false);
  const buttonId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Which item to focus when the menu opens: first (click/Enter/ArrowDown) or last (ArrowUp).
  const focusOnOpen = useRef<'first' | 'last'>('first');

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusOnOpen.current === 'last' ? list[list.length - 1] : list[0])?.focus();

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  function onMenuKeyDown(e: ReactKeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') setOpen(false);
  }

  function onButtonKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOnOpen.current = e.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    }
  }

  return {
    open,
    close,
    containerRef,
    buttonProps: {
      ref: buttonRef,
      id: buttonId,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      onClick: () => {
        focusOnOpen.current = 'first';
        setOpen((v) => !v);
      },
      onKeyDown: onButtonKeyDown,
    },
    menuProps: { ref: menuRef, role: 'menu', 'aria-labelledby': buttonId, onKeyDown: onMenuKeyDown },
  };
}
