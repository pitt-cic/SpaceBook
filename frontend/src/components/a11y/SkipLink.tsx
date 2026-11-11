// First focusable element on every page: lets keyboard and screen-reader users
// jump past the header/sidebar straight to the page content (WCAG 2.4.1).
// Visually hidden until focused. Targets the layout's <main id="main-content">.
export function SkipLink() {
  return (
    <a
      href="#main-content"
      onClick={(e) => {
        // Hash links don't move focus in every browser; do it explicitly.
        const main = document.getElementById('main-content');
        if (!main) return;
        e.preventDefault();
        main.focus();
        main.scrollIntoView();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-surface focus:text-primary-700 focus:font-medium focus:shadow-lg"
    >
      Skip to main content
    </a>
  );
}
