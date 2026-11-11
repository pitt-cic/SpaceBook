import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// A client-side route change doesn't reload the page, so screen readers stay
// silent and keyboard focus is left on the link that was clicked (or on
// <body> if it unmounted). After each navigation this moves focus to the new
// page's <h1> (falling back to <main>), so the new page is announced and Tab
// continues from its top. The initial load is skipped — the browser handles it.
export function RouteFocus() {
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    // Wait a frame so the new page (and its async heading) has rendered.
    const id = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('main h1, h1') ?? document.querySelector<HTMLElement>('main');
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: false });
    });
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
