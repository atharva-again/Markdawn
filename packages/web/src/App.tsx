import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthIdentityBoundary } from './components/auth/AuthIdentityBoundary';
import { OnboardingGate } from './components/auth/OnboardingGate';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ShareablePageRoute } from './components/auth/ShareablePageRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoadingState } from './components/editor/PageLoadingState';
import { ExplorerLoadingState } from './components/workspace/ExplorerLoadingState';
import { AuthSessionProvider } from './hooks/useAuth';
import Dashboard from './routes/Dashboard';
import FolderEntry from './routes/FolderEntry';
import Home from './routes/Home';
import Login from './routes/Login';
import Onboarding from './routes/Onboarding';
import PageEntry from './routes/PageEntry';
import Settings from './routes/Settings';
import SharedWithMe from './routes/SharedWithMe';
import Trash from './routes/Trash';

function OnboardingIndexRedirect() {
  const location = useLocation();
  return <Navigate to="/onboarding/1" replace state={location.state} />;
}

function App() {
  return (
    <ErrorBoundary>
      <div className="bg-white dark:bg-zinc-950 min-h-screen text-zinc-900 dark:text-zinc-50">
        <BrowserRouter>
          <AuthSessionProvider>
            <AuthIdentityBoundary>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route
                  path="/onboarding"
                  element={
                    <ProtectedRoute>
                      <OnboardingIndexRedirect />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/onboarding/:onboardingStep"
                  element={
                    <ProtectedRoute>
                      <Onboarding />
                    </ProtectedRoute>
                  }
                />

                <Route
                  element={
                    <OnboardingGate>
                      <Outlet />
                    </OnboardingGate>
                  }
                >
                  <Route
                    path="/app"
                    element={
                      <ProtectedRoute>
                        <AppShell />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Dashboard />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="trash" element={<Trash />} />
                    <Route path="shared-with-me" element={<SharedWithMe />} />
                  </Route>

                  <Route
                    path="/app/:slugAndId"
                    element={
                      <ShareablePageRoute entityType="page" loadingState={<PageLoadingState />} />
                    }
                  >
                    <Route index element={<PageEntry />} />
                  </Route>

                  <Route
                    path="/app/folder/:slugAndId"
                    element={
                      <ShareablePageRoute
                        entityType="folder"
                        loadingState={<ExplorerLoadingState />}
                      />
                    }
                  >
                    <Route index element={<FolderEntry />} />
                  </Route>
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthIdentityBoundary>
          </AuthSessionProvider>
        </BrowserRouter>
      </div>
    </ErrorBoundary>
  );
}

export default App;
