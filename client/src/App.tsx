import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { desktop } from './desktop';
import { useToast } from './toast';
import { TitleBar } from './components/TitleBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ListsPage } from './pages/ListsPage';
import { ListDetailPage } from './pages/ListDetailPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const sde = useQuery({
    queryKey: ['sde-status'],
    queryFn: api.sdeStatus,
    refetchInterval: (q) => (q.state.data?.ready ? false : 1500),
  });

  // Desktop builds download updates in the background and apply them on quit.
  const toast = useToast();
  useEffect(() => {
    return desktop()?.onUpdateReady((version) => {
      toast(`Viator ${version} downloaded — restart to apply.`, 'success');
    });
  }, [toast]);

  if (!sde.data) {
    return (
      <div className="splash">
        <div className="spinner" />
        <div>Starting…</div>
      </div>
    );
  }

  if (!sde.data.ready) {
    return (
      <div className="splash">
        <div className="spinner" />
        <div>{sde.data.message ?? 'Preparing static data…'}</div>
        <div className="muted">This runs once per EVE data update.</div>
      </div>
    );
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="content">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Navigate to="/lists" replace />} />
            <Route path="/lists" element={<ListsPage />} />
            <Route path="/lists/:id" element={<ListDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/lists" replace />} />
          </Routes>
        </ErrorBoundary>
      </div>
    </div>
  );
}
