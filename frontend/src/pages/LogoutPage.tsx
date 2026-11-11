import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PublicLayout } from '../components/a11y/PublicLayout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useAuth } from '../hooks/useAuth';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function LogoutPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  useDocumentTitle('Signed out');

  useEffect(() => {
    logout();
  }, [logout]);

  return (
    <PublicLayout className="px-4 py-8" mainClassName="flex items-center justify-center">
      <div className="w-full max-w-md">
        <Card className="text-center">
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
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-ink mb-2">You've been signed out</h1>
          <p className="text-ink-3 mb-6">
            Thank you for using our application. You have been successfully logged out.
          </p>

          <Button onClick={() => navigate('/login')}>Back to Sign in</Button>
        </Card>
      </div>
    </PublicLayout>
  );
}
