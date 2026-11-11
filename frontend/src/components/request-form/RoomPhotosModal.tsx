import { useEffect, useState } from 'react';
import type { Room } from '../../types/api';
import { ChevronRightIcon } from '../icons';
import { ModalShell } from '../staff/ModalShell';
import { Button } from '../ui/Button';

interface Props {
  room: Room;
  onClose: () => void;
}

// ModalShell provides the dialog semantics (role="dialog", focus trap, Escape
// closes, focus returns to the photo tile). ArrowLeft/ArrowRight and the
// Previous/Next buttons step through the photos; the counter is a live region
// so the change is announced.
export function RoomPhotosModal({ room, onClose }: Props) {
  const photos = room.photos ?? [];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (photos.length < 2) return;
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length);
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length]);

  if (photos.length === 0) return null;
  const current = photos[index];
  const step = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);

  return (
    <ModalShell
      title={`Photos of ${room.name}`}
      onClose={onClose}
      footer={
        <div className="w-28">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <img
        src={current}
        alt={`Photo ${index + 1} of ${photos.length}: ${room.name}`}
        className="w-full max-h-[55vh] object-contain rounded-xl bg-surface-2 border border-hairline"
      />
      {photos.length > 1 && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous photo"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-hairline-strong text-ink-2 hover:bg-canvas"
          >
            <ChevronRightIcon className="w-4 h-4 rotate-180" />
          </button>
          <div className="relative flex gap-2 overflow-x-auto flex-1 min-w-0" role="group" aria-label="Choose a photo">
            {photos.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1} of ${photos.length}`}
                aria-pressed={i === index}
                className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden border ${
                  i === index ? 'ring-2 ring-primary-600 border-primary-600' : 'border-hairline-strong opacity-80 hover:opacity-100'
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next photo"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border border-hairline-strong text-ink-2 hover:bg-canvas"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        <span aria-live="polite">
          Photo {index + 1} of {photos.length}
        </span>{' '}
        ·{' '}
        <a href={current} target="_blank" rel="noopener noreferrer" className="text-primary-600 font-medium hover:underline">
          Open full size<span aria-hidden="true"> ↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </ModalShell>
  );
}
