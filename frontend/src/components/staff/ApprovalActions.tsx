import { useId, useState } from 'react';
import { useApproveRequest } from '../../hooks/useApproveRequest';
import { useDenyRequest } from '../../hooks/useDenyRequest';
import { useModifyRequest } from '../../hooks/useModifyRequest';
import { toMinutes } from '../../lib/availability';
import { findConflictingApproved, findRoomConflict, PREFERENCE_ORDINALS, preferredRooms } from '../../lib/conflicts';
import { isHalfHourAligned } from '../../lib/dates';
import type { BookingRequest, Room } from '../../types/api';

interface Props {
  request: BookingRequest;
  site: string;
  rooms: Room[];
  siteRequests: BookingRequest[];
  // Called after a successful decision with a message to announce (the modal closes).
  onDone: (message: string) => void;
}


export function ApprovalActions({ request, site, rooms, siteRequests, onDone }: Props) {
  const ids = useId();
  const approveRequest = useApproveRequest();
  const denyRequest = useDenyRequest();
  const modifyRequest = useModifyRequest();
  const [denyReason, setDenyReason] = useState('');
  const [proposalRoom, setProposalRoom] = useState('');
  const [proposalDate, setProposalDate] = useState('');
  const [proposalStart, setProposalStart] = useState('');
  const [proposalEnd, setProposalEnd] = useState('');
  const [proposalMessage, setProposalMessage] = useState('');
  const [proposalTimeError, setProposalTimeError] = useState('');
  // null = not picked yet, so the default can follow siteRequests as it loads.
  const [pickedRoom, setPickedRoom] = useState<string | null>(null);

  // The requestor's rooms are preferences; staff assign the actual room on
  // approve. Default to the first preference that's free at this time.
  const preferences = preferredRooms(request);
  const isBooked = (roomId: string) => Boolean(findRoomConflict(request, roomId, siteRequests));
  const assignedRoom = pickedRoom ?? preferences.find((id) => !isBooked(id)) ?? '';
  const assigned = rooms.find((r) => r.id === assignedRoom);
  const assignedBooked = Boolean(assignedRoom) && isBooked(assignedRoom);
  const otherRooms = rooms.filter((r) => !preferences.includes(r.id));
  const roomOption = (id: string, prefix = '') => {
    const room = rooms.find((r) => r.id === id);
    const booked = isBooked(id);
    return (
      <option key={id} value={id} disabled={booked || !room}>
        {prefix}
        {room ? `${room.name} · seats ${room.capacity}` : `${id} (inactive)`}
        {room?.hidden ? ' · staff only' : ''}
        {booked ? ' · booked' : ''}
      </option>
    );
  };

  const mutating = approveRequest.isPending || denyRequest.isPending || modifyRequest.isPending;
  const mutationError = approveRequest.error || denyRequest.error || modifyRequest.error;

  // Same read-time check as the approve button's, against the effective
  // proposal (blank fields keep the request's own value, as the backend does).
  // requests_staff.modify_request re-checks the slot locks server-side.
  const proposalConflict = findConflictingApproved(
    {
      ...request,
      room: proposalRoom || request.room,
      date: proposalDate || request.date,
      start: proposalStart || request.start,
      end: proposalEnd || request.end,
    },
    siteRequests,
  );

  // Each decision is its own labeled group (role="group" named by its heading)
  // with its own confirm button, so a screen reader announces "Approve,
  // group" / "Deny, group" / "Counter-propose, group" on entering it.
  const fieldClass = 'w-full rounded-lg border border-field bg-surface-2 p-2 text-xs';
  return (
    <div className="space-y-2.5 text-xs">
      <div className="grid sm:grid-cols-2 gap-2.5">
        <div
          role="group"
          aria-labelledby={`${ids}-approve`}
          className="rounded-xl border border-green-200 bg-surface p-3 flex flex-col min-w-0"
        >
          <h4 id={`${ids}-approve`} className="font-semibold text-ok-fg">
            <span aria-hidden="true">✔ </span>Approve
          </h4>
          <label className="mt-1.5 flex flex-col gap-1 min-w-0">
            <span className="text-ink-3">Assign room</span>
            <select
              className={fieldClass}
              value={assignedRoom}
              onChange={(e) => setPickedRoom(e.target.value)}
            >
              <option value="" disabled>
                Choose a room…
              </option>
              <optgroup label="Requested">
                {preferences.map((id, i) => roomOption(id, `${PREFERENCE_ORDINALS[i]} choice · `))}
              </optgroup>
              {otherRooms.length > 0 && (
                <optgroup label="Other rooms">{otherRooms.map((r) => roomOption(r.id))}</optgroup>
              )}
            </select>
          </label>
          <div aria-live="polite">
            {!assignedRoom && (
              <p className="mt-1 text-warn-fg">None of the requested rooms are free then. Assign another room or counter-propose.</p>
            )}
            {assigned && assigned.capacity < request.attendance && (
              <p className="mt-1 text-warn-fg">
                Seats {assigned.capacity}, fewer than the {request.attendance} attending.
              </p>
            )}
          </div>
          <p className="text-ink-3 mt-1.5 mb-3">
            Notifies {request.org} that {assigned ? assigned.name : 'the room'} is confirmed.
          </p>
          <button
            type="button"
            disabled={!assignedRoom || assignedBooked || mutating}
            onClick={() =>
              approveRequest.mutate(
                { id: request.id, site, room: assignedRoom },
                { onSuccess: () => onDone(`Approved. ${request.title} is booked in ${assigned?.name ?? assignedRoom}.`) },
              )
            }
            className="mt-auto w-full rounded-lg bg-ok-fg text-white py-2 font-semibold disabled:opacity-40"
          >
            Confirm Approval
          </button>
        </div>

        <div
          role="group"
          aria-labelledby={`${ids}-deny`}
          className="rounded-xl border border-red-200 bg-surface p-3 flex flex-col min-w-0"
        >
          <h4 id={`${ids}-deny`} className="font-semibold text-err-fg">
            <span aria-hidden="true">✖ </span>Deny
          </h4>
          <label className="mt-1.5 flex flex-col flex-1 gap-1 min-w-0">
            <span className="text-ink-3">Reason (sent to requestor)</span>
            <textarea
              className={`${fieldClass} flex-1 min-h-[3.5rem]`}
              placeholder="e.g. Room unavailable due to maintenance."
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={mutating}
            onClick={() =>
              denyRequest.mutate(
                { id: request.id, reason: denyReason, site },
                { onSuccess: () => onDone(`Denied. ${request.org} will be notified.`) },
              )
            }
            className="mt-3 w-full rounded-lg bg-err-fg text-white py-2 font-semibold disabled:opacity-40"
          >
            Confirm Denial
          </button>
        </div>
      </div>

      <div
        role="group"
        aria-labelledby={`${ids}-counter`}
        className="rounded-xl border border-primary-200 bg-surface p-3 flex flex-col gap-2 min-w-0"
      >
        <h4 id={`${ids}-counter`} className="font-semibold text-info-fg">
          <span aria-hidden="true">✏ </span>Counter-Propose
        </h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-ink-3">Room</span>
            <select
              className={fieldClass}
              value={proposalRoom}
              onChange={(e) => setProposalRoom(e.target.value)}
            >
              <option value="">Keep room: {rooms.find((r) => r.id === request.room)?.name ?? request.room}</option>
              {rooms
                .filter((r) => r.id !== request.room)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-ink-3">Date</span>
            <input
              type="date"
              className={fieldClass}
              value={proposalDate}
              onChange={(e) => setProposalDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-ink-3">Start time</span>
            <input
              type="time"
              step="1800"
              className={`${fieldClass} min-w-0`}
              value={proposalStart}
              onChange={(e) => setProposalStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 min-w-0">
            <span className="text-ink-3">End time</span>
            <input
              type="time"
              step="1800"
              className={`${fieldClass} min-w-0`}
              value={proposalEnd}
              onChange={(e) => setProposalEnd(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 min-w-0">
          <span className="text-ink-3">Note to requestor (optional)</span>
          <input
            type="text"
            className={fieldClass}
            value={proposalMessage}
            onChange={(e) => setProposalMessage(e.target.value)}
          />
        </label>
        <p className="text-ink-3">Leave a field blank to keep the request's own value.</p>
        {proposalConflict && (
          <p role="alert" className="text-err-fg">
            This room is already booked then — {proposalConflict.id}, {proposalConflict.title},{' '}
            {proposalConflict.start}–{proposalConflict.end}. Pick another room or time.
          </p>
        )}
        {proposalTimeError && (
          <p role="alert" className="text-err-fg">
            {proposalTimeError}
          </p>
        )}
        <button
          type="button"
          disabled={mutating || Boolean(proposalConflict)}
          onClick={() => {
            if ((proposalStart && !isHalfHourAligned(proposalStart)) || (proposalEnd && !isHalfHourAligned(proposalEnd))) {
              setProposalTimeError('Times must be on the hour or half hour (e.g. 9:00 or 9:30).');
              return;
            }
            if (toMinutes(proposalEnd || request.end) <= toMinutes(proposalStart || request.start)) {
              setProposalTimeError('End time must be after start time.');
              return;
            }
            setProposalTimeError('');
            modifyRequest.mutate(
              {
                id: request.id,
                site,
                proposal: {
                  room: proposalRoom || undefined,
                  date: proposalDate || undefined,
                  start: proposalStart || undefined,
                  end: proposalEnd || undefined,
                  message: proposalMessage || undefined,
                },
              },
              { onSuccess: () => onDone(`Counter-proposal sent to ${request.org}.`) },
            );
          }}
          className="mt-1 w-full rounded-lg bg-primary-600 text-white py-2 font-semibold disabled:opacity-40"
        >
          Send Counter-Proposal
        </button>
      </div>

      {mutationError && (
        <p role="alert" className="text-err-fg">
          {mutationError.message}
        </p>
      )}
    </div>
  );
}
