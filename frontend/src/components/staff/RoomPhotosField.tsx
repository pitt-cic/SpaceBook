import { useEffect, useRef, useState } from 'react';
import { createPhotoUpload, uploadPhoto } from '../../api/roomsAdmin';
import { useAuth } from '../../hooks/useAuth';
import { CloseIcon } from '../icons';

export const MAX_ROOM_PHOTOS = 5;
const MAX_EDGE = 1600;

interface Props {
  site: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}

interface Pending {
  id: string;
  preview: string;
}

// Downscale to ≤1600px JPEG so phone photos land well under the 5 MB upload cap.
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85),
  );
}

export function RoomPhotosField({ site, photos, onChange, onUploadingChange }: Props) {
  const { getIdToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Upload/remove outcomes for screen readers (WCAG 4.1.3); errors use role="alert".
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Uploads finish out of order; append to the latest list, not the one captured at pick time.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => onUploadingChange(pending.length > 0), [pending.length, onUploadingChange]);

  const slotsLeft = MAX_ROOM_PHOTOS - photos.length - pending.length;

  async function addFiles(files: FileList) {
    setError(null);
    const picked = Array.from(files);
    const count = Math.min(picked.length, Math.max(slotsLeft, 0));
    if (count > 0) setStatus(`Uploading ${count} photo${count === 1 ? '' : 's'}…`);
    if (picked.length > slotsLeft) setError(`A room can have at most ${MAX_ROOM_PHOTOS} photos, so only the first ${slotsLeft} were added.`);
    await Promise.all(
      picked.slice(0, Math.max(slotsLeft, 0)).map(async (file) => {
        const item = { id: crypto.randomUUID(), preview: URL.createObjectURL(file) };
        setPending((p) => [...p, item]);
        try {
          const jpeg = await toJpeg(file).catch(() => {
            throw new Error(`Couldn't read ${file.name}. Use a JPG, PNG, or WebP image.`);
          });
          const upload = await createPhotoUpload(site, 'image/jpeg', await getIdToken());
          await uploadPhoto(upload, jpeg);
          photosRef.current = [...photosRef.current, upload.photoUrl];
          onChange(photosRef.current);
          setStatus(`Photo ${photosRef.current.length} added.`);
        } catch (e) {
          setError(e instanceof Error && e.message.startsWith("Couldn't") ? e.message : `Uploading ${file.name} failed. Please try again.`);
        } finally {
          URL.revokeObjectURL(item.preview);
          setPending((p) => p.filter((x) => x.id !== item.id));
        }
      }),
    );
  }

  function removePhoto(url: string, index: number) {
    onChange(photos.filter((p) => p !== url));
    setStatus(`Photo ${index + 1} removed.`);
    // The removed photo's button is gone; keep focus in the field.
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  return (
    <div role="group" aria-labelledby="room-photos-label">
      <p id="room-photos-label" className="block text-xs font-medium text-ink-2 mb-1.5">
        Photos <span className="text-ink-4 font-normal">({photos.length}/{MAX_ROOM_PHOTOS})</span>
      </p>
      <p role="status" className="sr-only">
        {status}
      </p>
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={url} className="relative w-24 h-16 rounded-lg overflow-hidden border border-hairline-strong bg-surface-2">
            <img src={url} alt={`Room photo ${i + 1}${i === 0 ? ' (cover)' : ''}`} className="w-full h-full object-cover" />
            {i === 0 && (
              <span className="absolute left-1 bottom-1 rounded bg-ink/85 text-white text-[10px] px-1" aria-hidden="true">
                Cover
              </span>
            )}
            <button
              type="button"
              onClick={() => removePhoto(url, i)}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-0.5 top-0.5 w-6 h-6 grid place-items-center rounded-full bg-ink/80 text-white hover:bg-ink"
            >
              <CloseIcon className="w-3 h-3" />
            </button>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.id} className="relative w-24 h-16 rounded-lg overflow-hidden border border-hairline-strong">
            <img src={p.preview} alt="" className="w-full h-full object-cover opacity-40" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="rounded bg-surface/90 px-1 text-[11px] font-medium text-ink-2">Uploading…</span>
            </span>
          </div>
        ))}
        {slotsLeft > 0 && (
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-describedby="room-photos-hint"
            className="w-24 h-16 rounded-lg border border-dashed border-field text-xs text-ink-3 hover:border-primary-400 hover:text-primary-600"
          >
            + Add photos
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        aria-label="Add room photos"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <p id="room-photos-hint" className="mt-1 text-xs text-ink-4">
        The first photo is the cover shown on the booking form. Photos save with the room.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-err-fg">
          {error}
        </p>
      )}
    </div>
  );
}
