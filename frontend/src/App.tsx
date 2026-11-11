import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { ApiError } from './api/client';
import { RequireRole } from './components/RequireRole';
import { RouteFocus } from './components/a11y/RouteFocus';
import { AuthProvider } from './hooks/useAuth';
import { OperatingSiteProvider } from './hooks/useOperatingSite';
import { RequestorAuthProvider } from './hooks/useRequestorAuth';
import AccountSettingsPage from './pages/AccountSettingsPage';
import AdminRoomsPage from './pages/AdminRoomsPage';
import AdminSitesPage from './pages/AdminSitesPage';
import AdminStaffPage from './pages/AdminStaffPage';
import CheckinPage from './pages/CheckinPage';
import DashboardPage from './pages/DashboardPage';
import ForceChangePasswordPage from './pages/ForceChangePasswordPage';
import LoginPage from './pages/LoginPage';
import LogoutPage from './pages/LogoutPage';
import MyRequestsPage from './pages/MyRequestsPage';
import RequestConfirmationPage from './pages/RequestConfirmationPage';
import RequestFormPage from './pages/RequestFormPage';
import StaffBookingPage from './pages/StaffBookingPage';
import StaffCalendarPage from './pages/StaffCalendarPage';
import StaffQueuePage from './pages/StaffQueuePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // React Query's default staleTime of 0 refetches every mounted query on
      // each tab focus/remount — with the calendar's per-day fan-out that's
      // dozens of calls per focus. 30s keeps staff views fresh without that.
      staleTime: 30_000,
      // A 4xx (expired session, forbidden, not found, bad input) won't change
      // on retry; retrying just multiplies traffic and delays the error UI.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 3,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RequestorAuthProvider>
          <OperatingSiteProvider>
            <RouteFocus />
            <Routes>
              {/* Public — no auth */}
              <Route path="/" element={<RequestFormPage />} />
              <Route path="/request" element={<RequestFormPage />} />
              <Route path="/request/confirmation" element={<RequestConfirmationPage />} />
              <Route path="/my-requests" element={<MyRequestsPage />} />

              {/* Pool A — staff/admin */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/logout" element={<LogoutPage />} />
              <Route path="/change-password" element={<ForceChangePasswordPage />} />

              <Route
                path="/staff/:site/queue"
                element={
                  <RequireRole roles={['staff']} siteParam="site">
                    <StaffQueuePage />
                  </RequireRole>
                }
              />
              <Route
                path="/staff/:site/calendar"
                element={
                  <RequireRole roles={['staff']} siteParam="site">
                    <StaffCalendarPage />
                  </RequireRole>
                }
              />
              <Route
                path="/staff/:site/book"
                element={
                  <RequireRole roles={['staff']} siteParam="site">
                    <StaffBookingPage />
                  </RequireRole>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <RequireRole roles={['admin', 'staff', 'checkin']}>
                    <DashboardPage />
                  </RequireRole>
                }
              />
              <Route
                path="/account"
                element={
                  <RequireRole roles={['admin', 'staff', 'checkin']}>
                    <AccountSettingsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/sites"
                element={
                  <RequireRole roles={['admin']}>
                    <AdminSitesPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/sites/:site/rooms"
                element={
                  <RequireRole roles={['admin']}>
                    <AdminRoomsPage />
                  </RequireRole>
                }
              />
              <Route
                path="/admin/staff"
                element={
                  <RequireRole roles={['admin']}>
                    <AdminStaffPage />
                  </RequireRole>
                }
              />
              <Route
                path="/checkin/:site"
                element={
                  <RequireRole roles={['staff', 'checkin']} siteParam="site">
                    <CheckinPage />
                  </RequireRole>
                }
              />
            </Routes>
          </OperatingSiteProvider>
        </RequestorAuthProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
