import { Navigate, useSearchParams } from 'react-router';
import { useMe } from '../../api/queries';
import { Logo } from '../../components/layout/Logo';
import { FullPageSpinner } from '../../components/ui/Spinner';

const ERROR_MESSAGES: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  invalid_request: 'The sign-in link expired. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const { data: user, isPending } = useMe();
  const [params] = useSearchParams();
  const error = params.get('error');

  if (isPending) return <FullPageSpinner />;
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold text-gray-900">Login</h1>
        <p className="mt-1 text-sm text-gray-500">Schedule cold email campaigns and track every send.</p>

        {error && (
          <div className="mt-5 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
            {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.google_failed}
          </div>
        )}

        {/* Full page navigation: the backend redirects to Google and back. */}
        <a
          href="/api/auth/google"
          className="mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-lg bg-brand-50 text-sm font-medium text-gray-800 transition-colors hover:bg-brand-100"
        >
          <GoogleIcon />
          Login with Google
        </a>

        <p className="mt-6 text-center text-xs text-gray-400">We only read your name, email and profile picture.</p>
      </div>
    </div>
  );
}
