import { useEffect } from 'react';

// Every route gets its own <title> (WCAG 2.4.2) — it's the first thing a
// screen reader announces after navigation. Pass the page's own name; the
// product name is appended.
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · SpaceBook`;
  }, [title]);
}
