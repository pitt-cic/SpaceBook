import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * App-wide last resort: without it, any exception thrown while rendering
 * unmounts the whole React root and the user sees a blank white page with no
 * clue what happened. Shows the message plus a reload instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
    // Sits outside the router, so it can't use useDocumentTitle (WCAG 2.4.2).
    document.title = 'Something went wrong · SpaceBook';
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Something went wrong</h1>
          <p className="mt-1.5 text-sm text-ink-3">
            This page hit an unexpected error. Reloading usually fixes it — if it keeps happening, let
            the SpaceBook team know what you were doing.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-surface-2 p-3 text-xs text-ink-2 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => window.location.reload()}>Reload page</Button>
            <Button variant="secondary" onClick={() => window.location.assign('/')}>
              Go to home
            </Button>
          </div>
        </div>
      </main>
    );
  }
}
