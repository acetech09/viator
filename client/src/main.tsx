import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { desktop } from './desktop';
import { ToastProvider } from './toast';
import { ConfirmProvider } from './confirm';
import './theme.css';

// In the Electron shell the window has no native caption bar and Windows draws the caption
// buttons over the page, so the titlebar has to leave room for them. Nothing overlaps in a
// browser, hence the class rather than an unconditional rule.
if (desktop()) document.documentElement.classList.add('desktop');

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
