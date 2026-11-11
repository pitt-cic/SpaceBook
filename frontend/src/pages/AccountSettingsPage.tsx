import { CognitoUserAttribute } from 'amazon-cognito-identity-js';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LockClosedIcon, ShieldCheckIcon, SignOutIcon } from '../components/icons';
import { StaffLayout } from '../components/StaffLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { siteLabel } from '../config/sites';
import { useAuth } from '../hooks/useAuth';

// Account/profile page — Option A of the Mobbin-referenced redesign
// (captain-approved via Lavish, ref .lavish/account-settings-redesign.html):
// an avatar identity header over calm read-only rows, password collapsed
// behind a Security-card button, and a right-rail "about your account" card.
// Still the same two Cognito calls ForceChangePasswordPage exercises during
// the forced first-login flow (updateAttributes/changePassword via the
// cognitoUser already in useAuth context) — only the presentation changed.
export default function AccountSettingsPage() {
  const { cognitoUser, email, groups } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // The last-saved values, so Cancel can revert an in-progress edit and the
  // read view keeps showing the persisted name while the form holds a draft.
  const [savedFirstName, setSavedFirstName] = useState('');
  const [savedLastName, setSavedLastName] = useState('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Opening an edit form autofocuses its first field; closing it (save or
  // cancel) unmounts the focused control, so send focus back to the button
  // that opened it instead of dropping it on <body> (WCAG 2.4.3).
  const editProfileButtonRef = useRef<HTMLButtonElement>(null);
  const changePasswordButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditingProfile = useRef(false);
  const wasChangingPassword = useRef(false);
  useEffect(() => {
    if (wasEditingProfile.current && !isEditingProfile) editProfileButtonRef.current?.focus();
    wasEditingProfile.current = isEditingProfile;
  }, [isEditingProfile]);
  useEffect(() => {
    if (wasChangingPassword.current && !isChangingPassword) changePasswordButtonRef.current?.focus();
    wasChangingPassword.current = isChangingPassword;
  }, [isChangingPassword]);

  useEffect(() => {
    if (!cognitoUser) return;
    cognitoUser.getUserAttributes((err, attributes) => {
      setIsLoadingProfile(false);
      if (err || !attributes) {
        setProfileLoadError(err?.message ?? 'Could not load your profile.');
        return;
      }
      const byName = Object.fromEntries(attributes.map((a) => [a.getName(), a.getValue()]));
      const first = byName.given_name ?? '';
      const last = byName.family_name ?? '';
      setFirstName(first);
      setLastName(last);
      setSavedFirstName(first);
      setSavedLastName(last);
    });
  }, [cognitoUser]);

  // Role/site chip derived from the caller's own Cognito groups — same shape
  // the sidebar/backend scoping uses (admin, or staff-<site>/checkin-<site>).
  const identity = useMemo(() => {
    const isAdmin = groups.includes('admin');
    const siteIds = [
      ...new Set(
        groups
          .filter((g) => g.startsWith('staff-') || g.startsWith('checkin-'))
          .map((g) => g.slice(g.indexOf('-') + 1)),
      ),
    ];
    const role = isAdmin
      ? 'Admin'
      : groups.some((g) => g.startsWith('staff-'))
        ? 'Staff'
        : groups.some((g) => g.startsWith('checkin-'))
          ? 'Front desk'
          : 'Member';
    const sites = siteIds.map(siteLabel).join(', ');
    return { role, sites };
  }, [groups]);

  const initials =
    `${savedFirstName.charAt(0)}${savedLastName.charAt(0)}`.toUpperCase() ||
    email.charAt(0).toUpperCase() ||
    '?';
  const fullName = [savedFirstName, savedLastName].filter(Boolean).join(' ');

  function startEditingProfile() {
    setFirstName(savedFirstName);
    setLastName(savedLastName);
    setProfileError(null);
    setProfileSuccess(false);
    setIsEditingProfile(true);
  }

  function cancelEditingProfile() {
    setFirstName(savedFirstName);
    setLastName(savedLastName);
    setProfileError(null);
    setIsEditingProfile(false);
  }

  function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cognitoUser) return;
    setProfileError(null);
    setProfileSuccess(false);
    setIsSavingProfile(true);

    const attributes = [
      new CognitoUserAttribute({ Name: 'given_name', Value: firstName.trim() }),
      new CognitoUserAttribute({ Name: 'family_name', Value: lastName.trim() }),
    ];
    cognitoUser.updateAttributes(attributes, (err) => {
      setIsSavingProfile(false);
      if (err) {
        setProfileError(err.message || 'Could not update your profile.');
        return;
      }
      setSavedFirstName(firstName.trim());
      setSavedLastName(lastName.trim());
      setIsEditingProfile(false);
      setProfileSuccess(true);
    });
  }

  function startChangingPassword() {
    setPasswordError(null);
    setPasswordSuccess(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setIsChangingPassword(true);
  }

  function cancelChangingPassword() {
    setPasswordError(null);
    setIsChangingPassword(false);
  }

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!cognitoUser) return;
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setIsSavingPassword(true);
    cognitoUser.changePassword(currentPassword, newPassword, (err) => {
      setIsSavingPassword(false);
      if (err) {
        setPasswordError(err.message || 'Could not change your password.');
        return;
      }
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setIsChangingPassword(false);
    });
  }

  return (
    <StaffLayout activeNav="account" title="Account Settings">
      <div className="max-w-4xl grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {/* Profile card: avatar identity header over read-only rows */}
          <section className="bg-surface rounded-2xl border border-hairline shadow-sm">
            <div className="p-6 flex items-center gap-4 border-b border-hairline">
              <span
                className="w-16 h-16 rounded-full bg-primary-600 text-white text-xl font-semibold grid place-items-center shrink-0"
                aria-hidden="true"
              >
                {initials}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-ink truncate">{fullName || 'Your account'}</h2>
                <div className="text-sm text-ink-3 truncate">{email}</div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-info-fg bg-info-bg rounded-full px-2 py-0.5">
                  <span className="sr-only">Role: </span>
                  {identity.role}
                  {identity.sites && ` · ${identity.sites}`}
                </div>
              </div>
            </div>

            {/* Kept mounted so "Profile updated." is announced when it appears. */}
            <div role="status">
              {profileSuccess && !isEditingProfile && !isLoadingProfile && !profileLoadError && (
                <div className="px-6 pt-4">
                  <div className="p-3 rounded-lg bg-ok-bg border border-green-200">
                    <p className="text-sm text-ok-fg">Profile updated.</p>
                  </div>
                </div>
              )}
            </div>
            {isLoadingProfile ? (
              <p role="status" className="px-6 py-5 text-sm text-ink-3">
                Loading…
              </p>
            ) : profileLoadError ? (
              <div className="px-6 py-5">
                <div role="alert" className="p-3 rounded-lg bg-err-bg border border-red-200">
                  <p className="text-sm text-err-fg">{profileLoadError}</p>
                </div>
              </div>
            ) : isEditingProfile ? (
              <form onSubmit={handleProfileSubmit} className="p-6 space-y-4">
                {profileError && (
                  <div role="alert" className="p-3 rounded-lg bg-err-bg border border-red-200">
                    <p className="text-sm text-err-fg">{profileError}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-4">
                  <Input
                    label="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    autoFocus
                    required
                  />
                  <Input
                    label="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" isLoading={isSavingProfile} className="w-auto">
                    Save changes
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-auto"
                    onClick={cancelEditingProfile}
                    disabled={isSavingProfile}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="divide-y divide-hairline">
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink-3">First name</div>
                    <div className="text-sm font-medium text-ink mt-0.5">
                      {savedFirstName || <span className="text-ink-4">Not set</span>}
                    </div>
                  </div>
                  <button
                    ref={editProfileButtonRef}
                    type="button"
                    onClick={startEditingProfile}
                    aria-label="Edit first name"
                    className="text-[13px] font-medium text-primary-600 hover:text-primary-700 shrink-0 px-1 py-1"
                  >
                    Edit
                  </button>
                </div>
                <div className="flex items-center justify-between px-6 py-4">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink-3">Last name</div>
                    <div className="text-sm font-medium text-ink mt-0.5">
                      {savedLastName || <span className="text-ink-4">Not set</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={startEditingProfile}
                    aria-label="Edit last name"
                    className="text-[13px] font-medium text-primary-600 hover:text-primary-700 shrink-0 px-1 py-1"
                  >
                    Edit
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 px-6 py-4">
                  <div className="min-w-0">
                    <div className="text-[13px] text-ink-3">Email (sign-in)</div>
                    <div className="text-sm font-medium text-ink mt-0.5 truncate">{email}</div>
                  </div>
                  <span className="text-[12px] text-ink-4 shrink-0">Managed by Pitt SSO</span>
                </div>
              </div>
            )}
          </section>

          {/* Security card: password collapsed behind a button */}
          <section className="bg-surface rounded-2xl border border-hairline shadow-sm">
            <div className="px-6 py-4 border-b border-hairline flex items-center gap-2">
              <ShieldCheckIcon className="w-4 h-4 text-ink-3" />
              <h2 className="text-sm font-semibold text-ink">Security</h2>
            </div>

            {isChangingPassword ? (
              <form onSubmit={handlePasswordSubmit} className="p-6 space-y-4">
                {passwordError && (
                  <div role="alert" className="p-3 rounded-lg bg-err-bg border border-red-200">
                    <p className="text-sm text-err-fg">{passwordError}</p>
                  </div>
                )}
                <Input
                  label="Current password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
                <Input
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <Input
                  label="Confirm new password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <div className="flex items-center gap-3">
                  <Button type="submit" isLoading={isSavingPassword} className="w-auto">
                    Update password
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-auto"
                    onClick={cancelChangingPassword}
                    disabled={isSavingPassword}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="px-6 py-4">
                {/* Kept mounted so "Password changed." is announced. */}
                <div role="status">
                  {passwordSuccess && (
                    <div className="mb-4 p-3 rounded-lg bg-ok-bg border border-green-200">
                      <p className="text-sm text-ok-fg">Password changed.</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg bg-neu-bg text-ink-3 grid place-items-center shrink-0">
                      <LockClosedIcon className="w-5 h-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink">Password</div>
                      <div className="text-[13px] text-ink-3">Set a new password for your account</div>
                    </div>
                  </div>
                  <button
                    ref={changePasswordButtonRef}
                    type="button"
                    onClick={startChangingPassword}
                    className="text-[13px] font-medium px-3 py-1.5 rounded-lg border border-hairline-strong text-ink-2 hover:bg-canvas shrink-0"
                  >
                    Change password
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right rail: account context + sign out */}
        <aside aria-labelledby="about-account-heading" className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
          <span className="w-9 h-9 rounded-lg bg-info-bg text-info-fg grid place-items-center mb-3">
            <ShieldCheckIcon className="w-5 h-5" />
          </span>
          <h2 id="about-account-heading" className="text-sm font-semibold text-ink mb-1.5">
            About your account
          </h2>
          <p className="text-[13px] text-ink-3 leading-relaxed">
            Your name shows on requests you approve. Site access is granted by an admin under{' '}
            <span className="text-ink-2 font-medium">Staff Access</span> — it can't be changed here.
          </p>
          <div className="mt-4 pt-4 border-t border-hairline">
            <Link
              to="/logout"
              className="inline-flex items-center gap-2 py-1 text-[13px] font-medium text-err-fg hover:underline"
            >
              <SignOutIcon className="w-4 h-4" />
              Sign out
            </Link>
          </div>
        </aside>
      </div>
    </StaffLayout>
  );
}
