import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { StaffMember } from '../api/staffAdmin';
import { BuildingIcon, CloseIcon, SearchIcon, ShieldCheckIcon } from '../components/icons';
import { ModalShell } from '../components/staff/ModalShell';
import { StaffLayout } from '../components/StaffLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { siteLabel } from '../config/sites';
import { useCreateStaff } from '../hooks/useCreateStaff';
import { useDialog } from '../hooks/useDialog';
import { useOperatingSite } from '../hooks/useOperatingSite';
import { useSetStaffGroups } from '../hooks/useSetStaffGroups';
import { useStaffRoster } from '../hooks/useStaffRoster';

// Staff roster + per-user site-membership screen,
// redesigned as Option A of the Mobbin-referenced pass (captain-approved via
// Lavish, ref .lavish/staff-access-redesign.html): an avatar roster showing
// each account's access as human role/site chips, with editing moved into a
// focused side drawer. Same backend contract as before — the drawer still
// submits the desired *full* group set to PUT .../groups, which the Lambda
// diffs server-side. Raw Cognito group names (admin, staff-<site>,
// checkin-<site>) are presented as Administrator / Staff / Check-in; the
// site list still comes from the backend's live availableGroups (Cognito
// ListGroups), not config/sites.ts.
// "New staff user" creates staff-only accounts (POST /api/admin/staff, Cognito
// invite email); admins are still created in Cognito directly.
export default function AdminStaffPage() {
  const { data, isLoading, error } = useStaffRoster();
  const setGroups = useSetStaffGroups();
  const { operatingSite } = useOperatingSite();

  const [query, setQuery] = useState('');
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingGroups, setPendingGroups] = useState<Record<string, string[]>>({});
  const [savingUsername, setSavingUsername] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Save outcome, announced after the drawer closes (WCAG 4.1.3).
  const [announcement, setAnnouncement] = useState('');

  const staff = data?.staff ?? [];
  const availableGroups = data?.availableGroups ?? [];
  const hasAdminGroup = availableGroups.includes('admin');

  // Unique site ids that have any staff-/checkin- group, sorted for stable order.
  const siteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of availableGroups) {
      if (g.startsWith('staff-') || g.startsWith('checkin-')) ids.add(g.slice(g.indexOf('-') + 1));
    }
    return [...ids].sort();
  }, [availableGroups]);

  const filtered = staff.filter((u) => u.email.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = staff.find((u) => u.username === selectedUsername) ?? null;

  function groupsFor(user: StaffMember): string[] {
    return pendingGroups[user.username] ?? user.groups;
  }

  function isDirty(user: StaffMember): boolean {
    const pending = pendingGroups[user.username];
    if (!pending) return false;
    return pending.length !== user.groups.length || !pending.every((g) => user.groups.includes(g));
  }

  function toggleGroup(user: StaffMember, group: string) {
    const current = groupsFor(user);
    const next = current.includes(group)
      ? current.filter((g) => g !== group)
      : [...current, group];
    setPendingGroups({ ...pendingGroups, [user.username]: next });
  }

  function clearPending(username: string) {
    setPendingGroups((prev) => {
      const next = { ...prev };
      delete next[username];
      return next;
    });
  }

  function closeDrawer() {
    if (selected) clearPending(selected.username);
    setSelectedUsername(null);
  }

  function save(user: StaffMember) {
    setSavingUsername(user.username);
    setRowError({ ...rowError, [user.username]: '' });
    setGroups.mutate(
      { username: user.username, groups: groupsFor(user) },
      {
        onSuccess: () => {
          clearPending(user.username);
          setSelectedUsername(null);
          setAnnouncement(`Access for ${user.email} saved.`);
        },
        onError: () =>
          setRowError({ ...rowError, [user.username]: 'Save failed. Please try again.' }),
        onSettled: () => setSavingUsername(null),
      },
    );
  }

  return (
    <StaffLayout activeNav="staff" site={operatingSite} title="Staff Access">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3 max-w-2xl">
          Grant or revoke which sites each account can access, or invite a new staff member.
          Administrator accounts are still created in Cognito directly.
        </p>
        {!isLoading && !error && (
          <Button
            className="w-auto"
            onClick={() => {
              setAnnouncement('');
              setShowCreate(true);
            }}
          >
            + New staff user
          </Button>
        )}
      </div>

      <p role="status" className="sr-only">
        {announcement || (!isLoading && !error && query.trim() ? `${filtered.length} people match` : '')}
      </p>
      {isLoading && <p className="text-sm text-ink-3 mt-4">Loading staff roster…</p>}
      {error && (
        <p role="alert" className="text-sm text-err-fg mt-4">
          Couldn't load the staff roster.
        </p>
      )}

      {!isLoading && !error && (
        <>
          <div className="mt-5 mb-4 relative max-w-xs">
            <SearchIcon className="w-4 h-4 text-ink-4 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Search people by email"
              value={query}
              onChange={(e) => {
                setAnnouncement('');
                setQuery(e.target.value);
              }}
              placeholder="Search people…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-field bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/25 focus:border-primary-400"
            />
          </div>

          <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
            {/* Visual column headings only; each list item reads as one person. */}
            <div
              aria-hidden="true"
              className="hidden sm:grid grid-cols-[2fr_1fr_2fr_auto] gap-3 px-5 py-2.5 text-[11px] uppercase tracking-wide text-ink-3 border-b border-hairline"
            >
              <span>Person</span>
              <span>Status</span>
              <span>Access</span>
              <span />
            </div>
            <ul aria-label="Staff accounts" className="divide-y divide-hairline">
              {filtered.map((user) => (
                <li
                  key={user.username}
                  className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr_auto] gap-2 sm:gap-3 px-5 py-3.5 sm:items-center hover:bg-surface-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-9 h-9 rounded-full ${avatarClass(user.email)} text-white text-xs font-semibold grid place-items-center shrink-0`}
                      aria-hidden="true"
                    >
                      {initials(user.email)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{user.email}</div>
                    </div>
                  </div>
                  <div>
                    <UserStatusPill enabled={user.enabled} status={user.status} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="sr-only">Access:</span>
                    <AccessChips groups={user.groups} />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUsername(user.username);
                      setRowError({ ...rowError, [user.username]: '' });
                    }}
                    className="justify-self-start sm:justify-self-auto text-[13px] font-medium px-3 py-1.5 rounded-lg border border-field text-ink-2 hover:bg-canvas whitespace-nowrap"
                  >
                    Manage<span className="sr-only"> access for {user.email}</span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-ink-3">
                {staff.length === 0 ? 'No staff accounts yet.' : 'No people match your search.'}
              </p>
            )}
          </div>
        </>
      )}

      {/* Access drawer */}
      {selected && (
        <>
          <div
            className="fixed inset-0 bg-ink/30 z-40"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <DrawerDialog onClose={closeDrawer} label={`Manage access for ${selected.email}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`w-9 h-9 rounded-full ${avatarClass(selected.email)} text-white text-xs font-semibold grid place-items-center shrink-0`}
                  aria-hidden="true"
                >
                  {initials(selected.email)}
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink truncate">{selected.email}</h2>
                  <div className="text-[12px] text-ink-3">
                    <UserStatusPill enabled={selected.enabled} status={selected.status} inline />
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-ink-3 hover:text-ink-2 hover:bg-canvas"
                aria-label="Close"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {hasAdminGroup && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheckIcon className="w-4 h-4 text-ink-3" />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Role</h3>
                  </div>
                  <label
                    className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${
                      groupsFor(selected).includes('admin')
                        ? 'border-primary-600 bg-primary-50/50'
                        : 'border-hairline-strong'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={groupsFor(selected).includes('admin')}
                      onChange={() => toggleGroup(selected, 'admin')}
                      className="mt-0.5 accent-primary-600"
                    />
                    <span>
                      <span className="text-sm font-medium text-ink block">Administrator</span>
                      <span className="text-[12px] text-ink-3">
                        Full access to every site &amp; all admin tools.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <BuildingIcon className="w-4 h-4 text-ink-3" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                    Site access
                  </h3>
                </div>
                {siteIds.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No sites are available yet.</p>
                ) : (
                  <div className="rounded-xl border border-hairline divide-y divide-hairline">
                    {siteIds.map((siteId) => {
                      const staffGroup = `staff-${siteId}`;
                      const checkinGroup = `checkin-${siteId}`;
                      const hasStaff = availableGroups.includes(staffGroup);
                      const hasCheckin = availableGroups.includes(checkinGroup);
                      const groups = groupsFor(selected);
                      return (
                        <div key={siteId} role="group" aria-labelledby={`access-site-${siteId}`} className="p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="w-2 h-2 rounded-full bg-primary-600" aria-hidden="true" />
                            <span id={`access-site-${siteId}`} className="text-sm font-medium text-ink">
                              {siteLabel(siteId)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {hasStaff && (
                              <label className="flex-1 flex items-center gap-2 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-[13px] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={groups.includes(staffGroup)}
                                  onChange={() => toggleGroup(selected, staffGroup)}
                                  className="accent-primary-600"
                                />
                                Staff<span className="sr-only"> at {siteLabel(siteId)}</span>
                              </label>
                            )}
                            {hasCheckin && (
                              <label className="flex-1 flex items-center gap-2 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-[13px] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={groups.includes(checkinGroup)}
                                  onChange={() => toggleGroup(selected, checkinGroup)}
                                  className="accent-primary-600"
                                />
                                Check-in<span className="sr-only"> at {siteLabel(siteId)}</span>
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[12px] text-ink-4 mt-2">
                  More sites appear here as they're created under Manage Sites.
                </p>
              </div>

              {rowError[selected.username] && (
                <p role="alert" className="text-sm text-err-fg">
                  {rowError[selected.username]}
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-hairline flex items-center gap-2">
              <Button
                className="w-auto flex-1"
                onClick={() => save(selected)}
                disabled={!isDirty(selected)}
                isLoading={savingUsername === selected.username}
              >
                Save
              </Button>
              <Button variant="secondary" className="w-auto" onClick={closeDrawer}>
                Cancel
              </Button>
            </div>
          </DrawerDialog>
        </>
      )}

      {showCreate && (
        <CreateStaffModal
          siteIds={siteIds.filter((siteId) => availableGroups.includes(`staff-${siteId}`))}
          onClose={() => setShowCreate(false)}
          onCreated={(email) => {
            setShowCreate(false);
            setAnnouncement(`Invitation sent to ${email}.`);
          }}
        />
      )}
    </StaffLayout>
  );
}

// --- presentational helpers -------------------------------------------------

// Invite form: email plus the staff-<site> groups to grant. Cognito emails the
// person a temporary password; they set their own at first sign-in.
function CreateStaffModal({
  siteIds,
  onClose,
  onCreated,
}: {
  siteIds: string[];
  onClose: () => void;
  onCreated: (email: string) => void;
}) {
  const createStaff = useCreateStaff();
  const [email, setEmail] = useState('');
  const [sites, setSites] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  function toggleSite(siteId: string) {
    setSites((prev) => (prev.includes(siteId) ? prev.filter((s) => s !== siteId) : [...prev, siteId]));
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (createStaff.isPending) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setFormError('Email is required.');
      return;
    }
    if (sites.length === 0) {
      setFormError('Select at least one site.');
      return;
    }
    setFormError(null);
    createStaff.mutate(
      { email: trimmed, groups: sites.map((siteId) => `staff-${siteId}`) },
      {
        onSuccess: (user) => onCreated(user.email || trimmed),
        onError: (err) =>
          setFormError(
            err instanceof ApiError && err.status <= 500 ? err.message : 'Create failed. Please try again.',
          ),
      },
    );
  }

  return (
    <ModalShell
      title="New staff user"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" className="w-auto text-sm px-3 py-1.5" onClick={onClose}>
            Cancel
          </Button>
          <Button className="w-auto text-sm px-3 py-1.5" onClick={() => submit()} isLoading={createStaff.isPending}>
            Send invite
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input
          id="new-staff-email"
          label="Email"
          type="email"
          autoComplete="off"
          required
          data-autofocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="They'll get an email with a temporary password and set their own at first sign-in."
        />
        <fieldset>
          <legend className="block text-xs font-medium text-ink-2 mb-1.5">Staff access at</legend>
          {siteIds.length === 0 ? (
            <p className="text-[13px] text-ink-3">No sites are available yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {siteIds.map((siteId) => (
                <label
                  key={siteId}
                  className="flex items-center gap-2 rounded-lg border border-hairline-strong px-2.5 py-1.5 text-[13px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={sites.includes(siteId)}
                    onChange={() => toggleSite(siteId)}
                    className="accent-primary-600"
                  />
                  {siteLabel(siteId)}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </form>
      {formError && (
        <p role="alert" className="mt-3 text-sm text-err-fg">
          {formError}
        </p>
      )}
    </ModalShell>
  );
}

// The access drawer as a modal dialog: useDialog gives it focus-on-open, a
// Tab trap, Escape-to-close and focus return to the row's Manage button.
function DrawerDialog({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="fixed top-0 right-0 h-full w-full max-w-sm bg-surface border-l border-hairline shadow-2xl z-50 flex flex-col focus:outline-none"
    >
      {children}
    </div>
  );
}

// Initials from the local part of an email, e.g. "jdoe@example.edu" -> "JD".
function initials(email: string): string {
  const local = email.split('@')[0] ?? email;
  const letters = local.replace(/[^a-zA-Z]/g, '');
  return (letters.slice(0, 2) || local.slice(0, 2) || '?').toUpperCase();
}

// Deterministic avatar tint so a person keeps the same color across renders.
const AVATAR_CLASSES = ['bg-primary-600', 'bg-neu-fg', 'bg-warn-fg', 'bg-ok-fg', 'bg-info-fg'];
function avatarClass(email: string): string {
  let sum = 0;
  for (const ch of email) sum += ch.charCodeAt(0);
  return AVATAR_CLASSES[sum % AVATAR_CLASSES.length];
}

function UserStatusPill({
  enabled,
  status,
  inline = false,
}: {
  enabled: boolean;
  status: string;
  inline?: boolean;
}) {
  let label = status;
  let cls = 'text-neu-fg bg-neu-bg';
  if (!enabled) {
    label = 'Disabled';
    cls = 'text-err-fg bg-err-bg';
  } else if (status === 'CONFIRMED') {
    label = 'Confirmed';
    cls = 'text-ok-fg bg-ok-bg';
  } else if (status === 'FORCE_CHANGE_PASSWORD') {
    label = 'Pending sign-in';
    cls = 'text-warn-fg bg-warn-bg';
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${cls} ${inline ? '' : ''}`}
    >
      {label}
    </span>
  );
}

function AccessChips({ groups }: { groups: string[] }) {
  const chips: { key: string; label: string; cls: string }[] = [];
  if (groups.includes('admin')) {
    chips.push({ key: 'admin', label: 'Administrator', cls: 'text-info-fg bg-info-bg' });
  }
  for (const g of groups) {
    if (g.startsWith('staff-')) {
      chips.push({
        key: g,
        label: `Staff · ${siteLabel(g.slice('staff-'.length))}`,
        cls: 'text-primary-700 bg-primary-50',
      });
    } else if (g.startsWith('checkin-')) {
      chips.push({
        key: g,
        label: `Check-in · ${siteLabel(g.slice('checkin-'.length))}`,
        cls: 'text-warn-fg bg-warn-bg',
      });
    }
  }
  if (chips.length === 0) {
    return <span className="text-xs font-medium text-neu-fg bg-neu-bg rounded-full px-2 py-0.5">No access</span>;
  }
  return (
    <>
      {chips.map((c) => (
        <span key={c.key} className={`text-xs font-medium rounded-full px-2 py-0.5 ${c.cls}`}>
          {c.label}
        </span>
      ))}
    </>
  );
}
