import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { AdminLayout } from './pages/AdminLayout';
import { Overview } from './pages/Overview';
import { UsersPage } from './pages/UsersPage';
import { TeamsPage } from './pages/TeamsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CommentsPage } from './pages/CommentsPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner size={24} /></div>;
  if (!user || !user.is_admin) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Guard>
            <AdminLayout />
          </Guard>
        }
      >
        <Route index element={<Overview />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="comments" element={<CommentsPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}