import { type FormEvent, useState } from 'react';
import { PublicLayout } from '../a11y/PublicLayout';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { useRequestorAuth } from '../../hooks/useRequestorAuth';

export function RequestorOtpGate() {
  const { step, isLoading, error, email, requestCode, verifyCode, reset, clearError } = useRequestorAuth();
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await requestCode(emailInput);
    } catch {
      // Surfaced via `error` below.
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await verifyCode(code);
    } catch {
      // Surfaced via `error` below.
    }
  }

  // Errors are announced as soon as they appear (WCAG 3.3.1 / 4.1.3).
  const errorBox = error && (
    <div role="alert" className="p-3 rounded-lg bg-err-bg border border-red-200">
      <p className="text-sm text-err-fg">{error}</p>
    </div>
  );

  return (
    <PublicLayout className="px-4 py-8" mainClassName="flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-ink">My Requests</h1>
          {/* Live, so "We sent a code…" is announced when the step changes. */}
          <p id="otp-instructions" role="status" className="text-ink-3 mt-1">
            {step === 'request-code'
              ? "Enter the email you used to submit a request — we'll send a one-time sign-in code."
              : `We sent a 6-digit code to ${email}. Enter it below to sign in.`}
          </p>
        </div>
        <Card>
          {step === 'request-code' ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              {errorBox}
              <Input
                label="Email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                aria-describedby="otp-instructions"
              />
              <Button type="submit" isLoading={isLoading}>
                Send Sign-in Code
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              {errorBox}
              <Input
                label="6-digit code"
                inputMode="numeric"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoComplete="one-time-code"
                aria-describedby="otp-instructions"
                // The field only mounts after the user asked for a code, so
                // moving focus here is the expected next step, not a surprise.
                autoFocus
              />
              <Button type="submit" isLoading={isLoading}>
                Verify &amp; Sign In
              </Button>
              <button
                type="button"
                onClick={reset}
                className="w-full text-center text-sm text-primary-600 hover:text-primary-700 py-1"
              >
                Use a different email
              </button>
            </form>
          )}
        </Card>
      </div>
    </PublicLayout>
  );
}
