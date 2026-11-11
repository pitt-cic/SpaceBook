import { useState } from 'react';
import { PREFERENCE_ORDINALS } from '../../lib/conflicts';
import type { RoomExclusion, RoomMatchResult } from '../../lib/roomMatching';
import type { Room } from '../../types/api';
import { formatShort } from '../../lib/dates';
import { UsersIcon } from '../icons';
import { Badge } from '../ui/Badge';
import { FormSection } from './FormSection';
import { RoomPhotosModal } from './RoomPhotosModal';

interface Props {
  date: string;
  /** Null until date, start, end, and headcount are all filled in. */
  result: RoomMatchResult | null;
  availabilityLoading: boolean;
  availabilityError: boolean;
  techNeeds: string[];
  /** Picked room ids, in order of preference. */
  picks: string[];
  maxPicks: number;
  onPicksChange: (ids: string[]) => void;
}

const EXCLUSION_LABELS: Record<RoomExclusion, string> = {
  capacity: 'too small',
  tech: 'missing tech',
  hours: 'outside open hours',
  booked: 'already booked',
};

// Step 2: the rooms that fit step 1's criteria; the requestor picks up to
// `maxPicks`, in click order (1st choice → room, 2nd/3rd → altRoom1/altRoom2).
export function RoomPicker({
  date,
  result,
  availabilityLoading,
  availabilityError,
  techNeeds,
  picks,
  maxPicks,
  onPicksChange,
}: Props) {
  const title = maxPicks === 1 ? 'Choose a room' : 'Choose your rooms';
  const [photoRoom, setPhotoRoom] = useState<Room | null>(null);

  // One render path (no early return) so the live region below stays mounted:
  // a screen reader only announces changes to a region that already exists.
  const matches = result?.matches ?? [];
  const full = picks.length >= maxPicks;
  function toggle(id: string) {
    if (picks.includes(id)) onPicksChange(picks.filter((p) => p !== id));
    else if (maxPicks === 1) onPicksChange([id]);
    else if (!full) onPicksChange([...picks, id]);
  }

  const excludedSummary = result
    ? (Object.keys(EXCLUSION_LABELS) as RoomExclusion[])
        .filter((k) => result.excluded[k] > 0)
        .map((k) => `${result.excluded[k]} ${EXCLUSION_LABELS[k]}`)
        .join(', ')
    : '';
  // Only reserve a photo slot on every card when at least one room has photos.
  const showTiles = matches.some(({ room }) => (room.photos?.length ?? 0) > 0);
  return (
    <FormSection step={2} title={title}>
      {/* Announces the match count (and loading/error) as step 1's filters change. */}
      <div role="status" aria-live="polite">
        {!result ? (
          <p className="text-sm text-ink-3">Enter a date, start and end time, and number of people to see rooms that fit.</p>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              {matches.length === 0
                ? 'No rooms fit these needs.'
                : `${matches.length} ${matches.length === 1 ? 'room fits' : 'rooms fit'} on ${formatShort(new Date(`${date}T00:00`))}. ` +
                  (maxPicks === 1 ? 'Pick one.' : `Pick up to ${maxPicks}, in order of preference.`)}
            </p>
            {excludedSummary && <p className="mt-0.5 text-xs text-ink-4">Not shown: {excludedSummary}.</p>}
            {availabilityLoading && <p className="mt-0.5 text-xs text-ink-4">Checking availability…</p>}
            {availabilityError && (
              <p className="mt-0.5 text-xs text-ink-3">
                Couldn't check availability right now, so some of these may already be booked. Staff will confirm.
              </p>
            )}
            {matches.length === 0 && (
              <p className="mt-1 text-xs text-ink-3">Try fewer people, fewer tech needs, a shorter setup/cleanup, or another time.</p>
            )}
          </>
        )}
      </div>

      {matches.length > 0 && (
        <ul className="grid sm:grid-cols-2 gap-2.5 mt-3" aria-label="Rooms that fit">
          {matches.map(({ room, pending }) => {
            const rank = picks.indexOf(room.id);
            const picked = rank >= 0;
            const disabled = !picked && full && maxPicks > 1;
            const photos = room.photos ?? [];
            const choiceLabel = maxPicks === 1 ? 'Selected' : `${PREFERENCE_ORDINALS[rank]} choice`;
            return (
              <li
                key={room.id}
                className={`rounded-xl border transition-colors flex flex-col overflow-hidden ${
                  picked
                    ? 'border-primary-600 bg-primary-50 ring-1 ring-primary-600'
                    : disabled
                      ? 'border-hairline bg-surface opacity-50'
                      : 'border-hairline-strong bg-surface hover:border-primary-200'
                }`}
              >
                {showTiles &&
                  (photos.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setPhotoRoom(room)}
                      aria-label={`View ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} of ${room.name}`}
                      className="relative h-24 m-2 mb-0 rounded-lg overflow-hidden bg-surface-2"
                    >
                      <img src={photos[0]} alt="" loading="lazy" className="w-full h-full object-cover" />
                      <span
                        className="absolute right-1.5 bottom-1.5 rounded-full bg-ink/85 text-white text-[10px] font-medium px-1.5 py-0.5"
                        aria-hidden="true"
                      >
                        {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
                      </span>
                    </button>
                  ) : (
                    <div
                      className="h-24 m-2 mb-0 rounded-lg border border-dashed border-hairline-strong bg-surface-2 grid place-items-center text-2xl"
                      aria-hidden="true"
                    >
                      {room.emoji}
                    </div>
                  ))}
                {/* A toggle button: aria-pressed carries picked/not picked, and the
                    visible "1st choice" badge is part of its name, so the pick
                    order is announced. When the picks are full it stays
                    focusable (aria-disabled, not disabled) so the reason is
                    still discoverable. */}
                <button
                  type="button"
                  aria-pressed={picked}
                  aria-disabled={disabled || undefined}
                  onClick={() => {
                    if (!disabled) toggle(room.id);
                  }}
                  className={`text-left p-3 flex flex-col gap-1.5 flex-1 ${disabled ? 'cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!showTiles && (
                      <span className="text-lg leading-none mt-0.5" aria-hidden="true">
                        {room.emoji}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink leading-snug">{room.name}</p>
                      <p className="text-xs text-ink-4 truncate">
                        {room.floor}
                        {room.area ? ` · ${room.area}` : ''}
                      </p>
                    </div>
                    {picked ? (
                      <span className="shrink-0 rounded-full bg-primary-600 text-white text-[11px] font-bold px-2 py-0.5">
                        <span className="sr-only">, </span>
                        {choiceLabel}
                      </span>
                    ) : (
                      <span className="shrink-0 w-4 h-4 mt-0.5 rounded-full border border-hairline-strong" aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                      <UsersIcon className="w-3.5 h-3.5" />
                      <span className="sr-only">, </span>Seats {room.capacity}
                    </span>
                    {room.hidden && <Badge variant="info">Staff only</Badge>}
                    {pending && <Badge variant="warning">Another request pending</Badge>}
                  </div>
                  {room.equipment.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {room.equipment.map((e) => (
                        <span
                          key={e}
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            techNeeds.includes(e) ? 'bg-primary-100 text-primary-600 font-medium' : 'bg-surface-2 text-ink-3'
                          }`}
                        >
                          {/* Requested tech is marked by more than color (WCAG 1.4.1). */}
                          {techNeeds.includes(e) && <span aria-hidden="true">✓ </span>}
                          <span className="sr-only">, </span>
                          {e}
                          {techNeeds.includes(e) && <span className="sr-only"> (requested)</span>}
                        </span>
                      ))}
                    </div>
                  )}
                  {room.restrictions.length > 0 && (
                    <p className="text-[11px] text-warn-fg">
                      <span className="sr-only">Restrictions: </span>
                      {room.restrictions.join(' · ')}
                    </p>
                  )}
                  {disabled && (
                    <span className="sr-only">
                      Unavailable: you've already picked {maxPicks} rooms. Remove one to choose this room.
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {photoRoom && <RoomPhotosModal room={photoRoom} onClose={() => setPhotoRoom(null)} />}
    </FormSection>
  );
}
