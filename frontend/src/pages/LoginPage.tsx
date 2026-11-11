import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/a11y/PublicLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { parseGroups, useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { destinationForGroups } from '../lib/roleRouting';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useDocumentTitle('Staff & Admin Sign In');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      const result = await login(email, password);

      if (result.status === 'newPasswordRequired') {
        navigate('/change-password');
      } else {
        navigate(destinationForGroups(parseGroups(result.session)));
      }
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
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink">Staff &amp; Admin Sign In</h1>
          <p className="text-ink-3 mt-1">SpaceBook — CEC staff and administrators</p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="p-3 rounded-lg bg-err-bg border border-red-200">
                <p className="text-sm text-err-fg">{error}</p>
              </div>
            )}

            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />

            <Button type="submit" isLoading={isLoading}>
              Sign in
            </Button>
          </form>
        </Card>

        <p className="text-center text-sm text-ink-3 mt-6">Protected by AWS Cognito</p>
      </div>
    </PublicLayout>
  );
}
