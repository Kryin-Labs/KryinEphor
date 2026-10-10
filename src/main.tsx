import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { logger } from './lib/logger'

window.addEventListener('error', (event) => {
  void logger.error('system', 'Application runtime error', {
    action: 'app.runtime_error', status: 'failed',
    details: { file: event.filename?.split('?')[0], line: event.lineno, column: event.colno },
  });
});
window.addEventListener('unhandledrejection', () => {
  void logger.error('system', 'Unhandled application request failure', {
    action: 'app.unhandled_rejection', status: 'failed',
  });
});

// ─────────────────────────────────────────────────────────────
// 📝 Author: Narco / Arth
// 🔗 GitHub: https://github.com/ArthOfficial
// 🌐 Website: https://arth-hub.vercel.app
// © 2026 Arth — All rights reserved.
// ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
