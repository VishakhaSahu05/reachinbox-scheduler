import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './features/auth/LoginPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { ComposePage } from './features/compose/ComposePage';
import { EmailDetailPage } from './features/emails/EmailDetailPage';
import { EmailListPage } from './features/emails/EmailListPage';

// Keeps the query string (e.g. ?slack=connected after the OAuth redirect) when landing on "/".
function HomeRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/scheduled', search }} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="scheduled" element={<EmailListPage key="scheduled" view="scheduled" />} />
          <Route path="sent" element={<EmailListPage key="sent" view="sent" />} />
          <Route path="compose" element={<ComposePage />} />
          <Route path="emails/:id" element={<EmailDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
