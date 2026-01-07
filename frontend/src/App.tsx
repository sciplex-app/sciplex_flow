import { Routes, Route, Navigate } from 'react-router-dom';
import { useWebSocket } from './hooks/useWebSocket';
import FlowEditorPage from './pages/FlowEditorPage';
import WorkspacePage from './pages/WorkspacePage';
import LoginPage from './pages/LoginPage';
import Navigation from './components/Navigation';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastContainer } from './components/ToastContainer';
import { useToastStore } from './store/toastStore';
import { useAuthStore } from './store/authStore';
import { config } from './config';

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  
  // Initialize WebSocket connection (it handles authentication internally)
  useWebSocket();
  
  // Toast system
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <div className="w-full h-full flex flex-col bg-[#1a1a1e]">
      {/* Top Navigation - show if authenticated or in local mode */}
      {(isAuthenticated || !config.authEnabled) && <Navigation />}
      
      {/* Page Content */}
      <div className="flex-1 overflow-hidden">
        <Routes>
          {/* Public routes - only show login if auth is enabled */}
          {config.authEnabled && <Route path="/login" element={<LoginPage />} />}
          
          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <FlowEditorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workspace"
            element={
              <ProtectedRoute>
                <WorkspacePage />
              </ProtectedRoute>
            }
          />
          
          {/* Redirect: to login if auth enabled and not authenticated, otherwise to home */}
          <Route
            path="*"
            element={<Navigate to={(config.authEnabled && !isAuthenticated) ? "/login" : "/"} replace />}
          />
        </Routes>
      </div>
      
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
