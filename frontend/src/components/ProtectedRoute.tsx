import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { config } from '../config';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // In local mode, always allow access
  if (config.authEnabled && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

