import { useEffect, useState } from 'react';

// Current time, re-rendering every `intervalMs` so "has this time passed?" checks stay live.
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
