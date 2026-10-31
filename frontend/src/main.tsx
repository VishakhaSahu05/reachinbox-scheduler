import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { queryKeys } from './api/queries';
import { App } from './App';
import { ToastProvider } from './components/ui/Toast';
import './index.css';

// An expired session anywhere sends the user back to the login screen.
function onApiError(error: Error) {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(queryKeys.me, null);
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      // Don't hammer the API on 4xx; do retry network blips and 5xx.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
