import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/ui';
import { Layout } from './pages/Layout';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { DocumentsPage } from './pages/DocumentsPage';
import { DocEditor } from './pages/DocEditor';
import { SheetEditor } from './pages/SheetEditor';
import { WikiTree } from './pages/WikiTree';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetail } from './pages/ProjectDetail';
import { AiChat } from './pages/AiChat';
import { TeamsPage } from './pages/TeamsPage';
import { TeamDetail } from './pages/TeamDetail';
import { TrashPage } from './pages/TrashPage';
import { SharePage } from './pages/SharePage';
import { Spinner } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner size={24} /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route
        path="/"
        element={
          <Guard>
            <Layout />
          </Guard>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="docs" element={<DocumentsPage />} />
        <Route path="docs/:id" element={<DocEditor />} />
        <Route path="sheets/:id" element={<SheetEditor />} />
        <Route path="wiki" element={<WikiTree />} />
        <Route path="wiki/:id" element={<DocEditor />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="ai" element={<AiChat />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:id" element={<TeamDetail />} />
        <Route path="trash" element={<TrashPage />} />
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