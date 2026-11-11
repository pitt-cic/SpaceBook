import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ModalShell } from '../components/staff/ModalShell';
import { StaffLayout } from '../components/StaffLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useCreateSite } from '../hooks/useCreateSite';
import { useOperatingSite } from '../hooks/useOperatingSite';
import { useSites } from '../hooks/useSites';
import { useUpdateSite } from '../hooks/useUpdateSite';
import type { Site } from '../types/api';

interface SiteForm {
  label: string;
  color: string;
  // Blank = no site-specific limit on a repeating request's occurrences.
  maxOccurrences: string;
}

// Mirrors rooms_admin's MAX_OCCURRENCES_CAP (the hard cap on any series).
const MAX_OCCURRENCES_CAP = 52;

// Curated palette (UI redesign decision #4) — replaces the free-text
// "Color (hex)" input. Homewood's seeded navy is first; the other five are
// chosen to read clearly against white without colliding with Badge's
// existing red/amber/green semantic meaning elsewhere in the app.
const SITE_COLOR_SWATCHES = ['#003594', '#0B6E4F', '#7A4FB5', '#B5541C', '#146873', '#5B6470'];
// Spoken/visible names for the swatches, so the picker isn't color-only (WCAG 1.4.1).
const SWATCH_NAMES: Record<string, string> = {
  '#003594': 'Navy',
  '#0B6E4F': 'Green',
  '#7A4FB5': 'Purple',
  '#B5541C': 'Orange',
  '#146873': 'Teal',
  '#5B6470': 'Slate',
};
const colorName = (hex: string) => SWATCH_NAMES[hex.toUpperCase()] ?? hex;

const EMPTY_FORM: SiteForm = { label: '', color: SITE_COLOR_SWATCHES[0], maxOccurrences: '' };

// Site list/create screen. Creating a site provisions its
// staff-<site>/checkin-<site> Cognito groups server-side in the same request
// (rooms_admin/handler.py's provision_site_groups), so a freshly created site
// is immediately staffable and shows up in admin fan-out and the site pickers.
export default function AdminSitesPage() {
  const { data, isLoading, error } = useSites();
  const createSite = useCreateSite();
  const updateSite = useUpdateSite();
  const { operatingSite } = useOperatingSite();
  const [showForm, setShowForm] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [form, setForm] = useState<SiteForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  // Result of the last save/(de)activate, announced in a live region (WCAG 4.1.3).
  const [announcement, setAnnouncement] = useState('');
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const sites = data?.sites ?? [];
  const saving = createSite.isPending || updateSite.isPending;

  function startCreate() {
    setEditingSite(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function startEdit(site: Site) {
    setEditingSite(site);
    setForm({ label: site.label, color: site.color, maxOccurrences: site.maxOccurrences?.toString() ?? '' });
    setFormError(null);
    setShowForm(true);
  }

  function submit() {
    if (!form.label.trim()) {
      setFormError('Label is required.');
      return;
    }
    const maxText = form.maxOccurrences.trim();
    const maxOccurrences = maxText ? Number(maxText) : null;
    if (maxOccurrences !== null && !(Number.isInteger(maxOccurrences) && maxOccurrences >= 1 && maxOccurrences <= MAX_OCCURRENCES_CAP)) {
      setFormError(`Repeat limit must be a whole number from 1 to ${MAX_OCCURRENCES_CAP}, or blank for no limit.`);
      return;
    }
    const input = { label: form.label.trim(), color: form.color.trim() || undefined, maxOccurrences };
    const onSuccess = () => {
      setShowForm(false);
      setAnnouncement(editingSite ? `${input.label} saved.` : `${input.label} created.`);
    };
    const onError = () => setFormError(editingSite ? 'Save failed. Please try again.' : 'Create failed. Please try again.');
    if (editingSite) {
      updateSite.mutate({ site: editingSite.id, input }, { onSuccess, onError });
    } else {
      createSite.mutate(input, { onSuccess, onError });
    }
  }

  function toggleActive(site: Site) {
    updateSite.mutate(
      { site: site.id, input: { active: !site.active } },
      {
        onSuccess: () => setAnnouncement(`${site.label} ${site.active ? 'deactivated' : 'reactivated'}.`),
        onError: () => setAnnouncement(`Couldn't ${site.active ? 'deactivate' : 'reactivate'} ${site.label}.`),
      },
    );
  }

  // Radio-group arrow-key navigation for the color swatches (APG radio group):
  // arrows move and select; only the checked swatch is in the Tab order.
  function onSwatchKeyDown(e: KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + SITE_COLOR_SWATCHES.length) % SITE_COLOR_SWATCHES.length;
    setForm({ ...form, color: SITE_COLOR_SWATCHES[next] });
    swatchRefs.current[next]?.focus();
  }
  const checkedSwatch = Math.max(0, SITE_COLOR_SWATCHES.indexOf(form.color));

  return (
    <StaffLayout activeNav="sites" site={operatingSite} title="Manage Sites">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">
          Create a site to add its data record and provision its staff-/checkin- Cognito groups.
        </p>
        <Button className="w-auto" onClick={startCreate}>
          + New Site
        </Button>
      </div>

      {isLoading && <p className="text-sm text-ink-3">Loading sites…</p>}
      {error && (
        <p role="alert" className="text-sm text-err-fg">
          Couldn't load the site list.
        </p>
      )}

      {!isLoading && !error && (
        <div className="relative overflow-x-auto rounded-2xl border border-hairline bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Sites</caption>
            <thead className="text-ink-3 text-[11px] uppercase tracking-wide border-b border-hairline">
              <tr>
                <th scope="col" className="text-left px-3 py-2">Label</th>
                <th scope="col" className="text-left px-3 py-2">Id</th>
                <th scope="col" className="text-left px-3 py-2">Color</th>
                <th scope="col" className="text-left px-3 py-2">Repeat limit</th>
                <th scope="col" className="text-left px-3 py-2">Status</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {sites.map((site) => (
                <tr key={site.id} className="hover:bg-surface-2">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {site.label}
                  </th>
                  <td className="px-3 py-2 text-xs text-ink-3">{site.id}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ backgroundColor: site.color }}
                        aria-hidden="true"
                      />
                      {colorName(site.color) !== site.color ? `${colorName(site.color)} (${site.color})` : site.color}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">
                    {site.maxOccurrences ? `${site.maxOccurrences} occurrences` : <span className="text-ink-4">No limit</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={site.active ? 'text-ok-fg' : 'text-ink-4'}>
                      {site.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-3 whitespace-nowrap">
                    <Link
                      to={`/admin/sites/${site.id}/rooms`}
                      className="inline-block py-1 text-primary-600 hover:underline text-xs font-medium"
                    >
                      Manage Rooms<span className="sr-only"> for {site.label}</span>{' '}
                      <span aria-hidden="true">→</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => startEdit(site)}
                      className="inline-block py-1 text-primary-600 hover:underline text-xs font-medium"
                    >
                      Edit<span className="sr-only"> {site.label}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(site)}
                      className="inline-block py-1 text-xs font-medium text-ink-3 hover:underline"
                    >
                      {site.active ? 'Deactivate' : 'Reactivate'}
                      <span className="sr-only"> {site.label}</span>
                    </button>
                  </td>
                </tr>
              ))}
              {sites.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-3">
                    No sites yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ModalShell
          title={editingSite ? 'Edit Site' : 'New Site'}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button variant="secondary" className="w-auto text-sm px-3 py-1.5" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button className="w-auto text-sm px-3 py-1.5" onClick={submit} isLoading={saving}>
                {editingSite ? 'Save Changes' : 'Create Site'}
              </Button>
            </>
          }
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Input
              label="Label"
              required
              data-autofocus
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <div>
              <span id="site-color-label" className="block text-xs font-medium text-ink-2 mb-1.5">
                Color: {colorName(form.color)}
              </span>
              <div role="radiogroup" aria-labelledby="site-color-label" className="flex flex-wrap items-center gap-2">
                {SITE_COLOR_SWATCHES.map((swatch, i) => {
                  const checked = form.color === swatch;
                  return (
                    <button
                      key={swatch}
                      ref={(el) => {
                        swatchRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      aria-label={SWATCH_NAMES[swatch]}
                      tabIndex={i === checkedSwatch ? 0 : -1}
                      onClick={() => setForm({ ...form, color: swatch })}
                      onKeyDown={(e) => onSwatchKeyDown(e, i)}
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-white text-sm font-bold ${
                        checked ? 'border-primary-600 ring-2 ring-primary-200' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: swatch }}
                    >
                      {checked && <span aria-hidden="true">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <Input
                label="Repeat limit (occurrences)"
                type="number"
                min={1}
                max={MAX_OCCURRENCES_CAP}
                placeholder="No limit"
                hint="Most dates a requestor can ask for in one repeating request at this site. Leave blank for no limit."
                value={form.maxOccurrences}
                onChange={(e) => setForm({ ...form, maxOccurrences: e.target.value })}
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
