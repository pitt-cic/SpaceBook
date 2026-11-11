import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPinIcon } from '../components/icons';
import { ModalShell } from '../components/staff/ModalShell';
import { RoomPhotosField } from '../components/staff/RoomPhotosField';
import { StaffLayout } from '../components/StaffLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useCreateRoom } from '../hooks/useCreateRoom';
import { useRoomsAdmin } from '../hooks/useRoomsAdmin';
import { useSites } from '../hooks/useSites';
import { useUpdateRoom } from '../hooks/useUpdateRoom';
import type { Room } from '../types/api';

interface RoomForm {
  name: string;
  floor: string;
  area: string;
  capacity: string;
  equipment: string;
  setups: string;
  restrictions: string;
  emoji: string;
  hidden: boolean;
  photos: string[];
  openTime: string;
  closeTime: string;
}

const EMPTY_FORM: RoomForm = {
  name: '', floor: '', area: '', capacity: '', equipment: '', setups: '', restrictions: '', emoji: '', hidden: false, photos: [],
  openTime: '09:00', closeTime: '17:00',
};

function toList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function addOneHour(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + 60, 23 * 60 + 59); // cap at 23:59
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function durationLabel(openTime: string, closeTime: string): string {
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const mins = ch * 60 + cm - (oh * 60 + om);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h open` : `${h}h ${m}m open`;
}

function roomToForm(room: Room): RoomForm {
  return {
    name: room.name,
    floor: room.floor,
    area: room.area,
    capacity: String(room.capacity),
    equipment: room.equipment.join(', '),
    setups: room.setups.join(', '),
    restrictions: room.restrictions.join(', '),
    emoji: room.emoji,
    hidden: Boolean(room.hidden),
    photos: room.photos ?? [],
    openTime: room.openTime ?? '09:00',
    closeTime: room.closeTime ?? '17:00',
  };
}

// Per-site room list/create/edit screen. Lists via the
// admin-only GET /api/admin/sites/{site}/rooms (active + inactive, so a
// deactivated room stays visible here to reactivate) — see AGENTS.md for why
// that route exists alongside the public room listing.
export default function AdminRoomsPage() {
  const { site = '' } = useParams<{ site: string }>();
  const { data, isLoading, error } = useRoomsAdmin(site);
  const { data: sitesData } = useSites();
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RoomForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Result of the last save/(de)activate, announced in a live region (WCAG 4.1.3).
  const [announcement, setAnnouncement] = useState('');

  const rooms = data?.rooms ?? [];
  const saving = createRoom.isPending || updateRoom.isPending;
  const matchedSite = sitesData?.sites.find((s) => s.id === site);
  const siteLabel = matchedSite?.label ?? site;
  const siteColor = matchedSite?.color;

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function startEdit(room: Room) {
    setEditingId(room.id);
    setForm(roomToForm(room));
    setFormError(null);
    setShowForm(true);
  }

  function submit() {
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (form.closeTime <= form.openTime) {
      setFormError('Close time must be later than open time (both within the same day).');
      return;
    }
    const input = {
      name: form.name.trim(),
      floor: form.floor.trim(),
      area: form.area.trim(),
      capacity: Number(form.capacity) || 0,
      equipment: toList(form.equipment),
      setups: toList(form.setups),
      restrictions: toList(form.restrictions),
      emoji: form.emoji.trim() || undefined,
      hidden: form.hidden,
      photos: form.photos,
      openTime: form.openTime,
      closeTime: form.closeTime,
    };
    const onSuccess = () => {
      setShowForm(false);
      setAnnouncement(editingId ? `${input.name} saved.` : `${input.name} created.`);
    };
    const onError = () => setFormError('Save failed. Please try again.');
    if (editingId) {
      updateRoom.mutate({ site, roomId: editingId, input }, { onSuccess, onError });
    } else {
      createRoom.mutate({ site, input }, { onSuccess, onError });
    }
  }

  function toggleActive(room: Room) {
    updateRoom.mutate(
      { site, roomId: room.id, input: { active: !room.active } },
      {
        onSuccess: () => setAnnouncement(`${room.name} ${room.active ? 'deactivated' : 'reactivated'}.`),
        onError: () => setAnnouncement(`Couldn't ${room.active ? 'deactivate' : 'reactivate'} ${room.name}.`),
      },
    );
  }

  return (
    <StaffLayout activeNav="rooms" site={site} siteLabel={siteLabel} siteColor={siteColor} title="Manage Rooms">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Create, edit, and deactivate rooms in the {siteLabel} catalog.</p>
        <Button className="w-auto" onClick={startCreate}>
          + New Room
        </Button>
      </div>

      {isLoading && <p className="text-sm text-ink-3">Loading rooms…</p>}
      {error && (
        <p role="alert" className="text-sm text-err-fg">
          Couldn't load the room catalog.
        </p>
      )}

      {!isLoading && !error && (
        <div className="relative overflow-x-auto rounded-2xl border border-hairline bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Rooms at {siteLabel}</caption>
            <thead className="text-ink-3 text-[11px] uppercase tracking-wide border-b border-hairline">
              <tr>
                <th scope="col" className="text-left px-3 py-2">Name</th>
                <th scope="col" className="text-left px-3 py-2">Floor / Area</th>
                <th scope="col" className="text-left px-3 py-2">Capacity</th>
                <th scope="col" className="text-left px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rooms.map((room) => (
                <tr key={room.id} className="hover:bg-surface-2">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPinIcon className="w-4 h-4 text-ink-4 shrink-0" />
                      {room.name}
                    </span>
                  </th>
                  <td className="px-3 py-2">
                    {room.floor}
                    {room.floor && room.area ? ' · ' : ''}
                    {room.area}
                  </td>
                  <td className="px-3 py-2">{room.capacity}</td>
                  <td className="px-3 py-2">
                    <span className={room.active ? 'text-ok-fg' : 'text-ink-4'}>
                      {room.active ? 'Active' : 'Inactive'}
                    </span>
                    {room.hidden && <span className="text-ink-3"> · Staff only</span>}
                  </td>
                  <td className="px-3 py-2 text-right space-x-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => startEdit(room)}
                      className="inline-block py-1 text-primary-600 hover:underline text-xs font-medium"
                    >
                      Edit<span className="sr-only"> {room.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(room)}
                      className="inline-block py-1 text-xs font-medium text-ink-3 hover:underline"
                    >
                      {room.active ? 'Deactivate' : 'Reactivate'}
                      <span className="sr-only"> {room.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {rooms.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-3">
                    No rooms yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ModalShell
          title={editingId ? 'Edit Room' : 'New Room'}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button variant="secondary" className="w-auto text-sm px-3 py-1.5" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button className="w-auto text-sm px-3 py-1.5" onClick={submit} isLoading={saving} disabled={uploading}>
                {editingId ? 'Save Changes' : 'Create Room'}
              </Button>
            </>
          }
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="Name"
              required
              data-autofocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Capacity"
              type="number"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            />
            <Input label="Floor" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
            <Input label="Area" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
            <Input label="Emoji" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <Input
              label="Equipment (comma-separated)"
              value={form.equipment}
              onChange={(e) => setForm({ ...form, equipment: e.target.value })}
            />
            <Input
              label="Setups (comma-separated)"
              value={form.setups}
              onChange={(e) => setForm({ ...form, setups: e.target.value })}
            />
            <Input
              label="Restrictions (comma-separated)"
              value={form.restrictions}
              onChange={(e) => setForm({ ...form, restrictions: e.target.value })}
            />
            <RoomPhotosField
              site={site}
              photos={form.photos}
              onChange={(photos) => setForm((f) => ({ ...f, photos }))}
              onUploadingChange={setUploading}
            />
            <div className="flex items-start gap-2 text-sm text-ink-2">
              <input
                id="room-staff-only"
                type="checkbox"
                className="mt-1 w-4 h-4 accent-primary-600"
                aria-describedby="room-staff-only-hint"
                checked={form.hidden}
                onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
              />
              <div>
                <label htmlFor="room-staff-only">Staff only</label>
                <p id="room-staff-only-hint" className="text-xs text-ink-4">
                  Hidden from the public request form. Staff can still book it from New Booking.
                </p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                label="Opens at"
                type="time"
                value={form.openTime}
                onChange={(e) => {
                  const open = e.target.value;
                  const close = open >= form.closeTime ? addOneHour(open) : form.closeTime;
                  setForm((f) => ({ ...f, openTime: open, closeTime: close }));
                }}
              />
              <Input
                label="Closes at"
                type="time"
                min={form.openTime}
                value={form.closeTime}
                hint={form.closeTime > form.openTime ? durationLabel(form.openTime, form.closeTime) : undefined}
                onChange={(e) => setForm((f) => ({ ...f, closeTime: e.target.value }))}
              />
            </div>
          </div>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-err-fg">
              {formError}
            </p>
          )}
        </ModalShell>
      )}
    </StaffLayout>
  );
}
