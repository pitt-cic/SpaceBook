import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/a11y/PublicLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { parseGroups, useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { destinationForGroups } from '../lib/roleRouting';

export default function ForceChangePasswordPage() {
  const navigate = useNavigate();
  const { completeNewPasswordChallenge, isLoading, error, clearError } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  useDocumentTitle('Complete your profile');

  const passwordRequirements = [
    { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
    { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
    { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
    { label: 'One number', test: (p: string) => /\d/.test(p) },
  ];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    setValidationError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setValidationError('First name and last name are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    const allRequirementsMet = passwordRequirements.every((req) => req.test(newPassword));
    if (!allRequirementsMet) {
      setValidationError('Password does not meet all requirements');
      return;
    }

    try {
      const session = await completeNewPasswordChallenge(newPassword, {
        givenName: firstName.trim(),
        familyName: lastName.trim(),
      });
      navigate(destinationForGroups(parseGroups(session)));
    } catch {
      // Error is handled by the auth context
    }
  };

  return (
    <PublicLayout className="px-4 py-8" mainClassName="flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100 mb-4">
            <svg
              className="w-8 h-8 text-primary-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink">Complete your profile</h1>
          <p className="text-ink-3 mt-1">
            Please provide your details and create a new password
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-5">
            {(error || validationError) && (
              <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm text-err-fg">{validationError || error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-4">
              <Input
                label="First Name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                autoComplete="given-name"
                required
              />

              <Input
                label="Last Name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                autoComplete="family-name"
                required
              />
            </div>

            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
              aria-describedby="password-requirements"
              required
            />

            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
            />

            <div className="bg-surface-2 border border-hairline rounded-xl p-4">
              <p id="password-requirements-label" className="text-sm font-medium text-ink-2 mb-2">
                Password requirements:
              </p>
              {/* Described-by target of the New Password field. Each item says
                  "met"/"not met" in text — the check icon and green color alone
                  don't reach a screen reader (WCAG 1.4.1 / 1.3.1). */}
              <ul id="password-requirements" aria-labelledby="password-requirements-label" className="space-y-1">
                {passwordRequirements.map((req) => {
                  const met = req.test(newPassword);
                  return (
                    <li
                      key={req.label}
                      className={`text-sm flex items-center ${
                        met ? 'text-ok-fg' : 'text-ink-3'
                      }`}
                    >
                      {met ? (
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <circle cx="10" cy="10" r="3" />
                        </svg>
                      )}
                      {req.label}
                      <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <Button type="submit" isLoading={isLoading}>
              Complete setup
            </Button>
          </form>
        </Card>

        <button
          type="button"
          onClick={() => navigate('/login')}
          className="w-full text-center text-sm text-primary-600 hover:text-primary-700 mt-4 py-1"
        >
          Back to Sign in
        </button>
      </div>
    </PublicLayout>
  );
}
