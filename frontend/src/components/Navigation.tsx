import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Workflow, FolderOpen, LogOut } from 'lucide-react';
import { useFlowStore } from '../store/flowStore';
import { useAuthStore } from '../store/authStore';
import { config } from '../config';
import { useState, useEffect } from 'react';

export default function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const connectionStatus = useFlowStore((s) => s.connectionStatus);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [showOfflineIndicator, setShowOfflineIndicator] = useState(true);
  
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  
  // Hide offline indicator after 5 seconds if still disconnected
  // (WebSocket is optional, app works fine without it)
  useEffect(() => {
    if (connectionStatus === 'disconnected' || connectionStatus === 'error') {
      const timer = setTimeout(() => {
        setShowOfflineIndicator(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setShowOfflineIndicator(true);
    }
  }, [connectionStatus]);

  return (
    <nav className="h-12 bg-[#0f0f12] border-b border-white/10 flex items-center px-4 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4">
        <img 
          src="/sciplex.ico" 
          alt="Sciplex" 
          className="w-7 h-7"
          style={{ imageRendering: 'auto' }}
        />
        <span className="text-white font-semibold">Sciplex Flow</span>
      </div>

      {/* Nav Links */}
      <div className="flex gap-1">
        <Link
          to="/"
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2
            ${location.pathname === '/' 
              ? 'bg-white/10 text-white' 
              : 'text-gray-400 hover:text-white hover:bg-white/5'}
          `}
        >
          <Workflow className="w-4 h-4" />
          Flow Editor
        </Link>
        <Link
          to="/workspace"
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2
            ${location.pathname === '/workspace' 
              ? 'bg-white/10 text-white' 
              : 'text-gray-400 hover:text-white hover:bg-white/5'}
          `}
        >
          <FolderOpen className="w-4 h-4" />
          Workspace
        </Link>
      </div>

      {/* Right side - User info and logout (only in server mode) */}
      <div className="ml-auto flex items-center gap-4">
        {/* User email - only show in server mode */}
        {config.authEnabled && user && (
          <span className="text-sm text-gray-400">{user.email}</span>
        )}
        
        {/* Logout button - only show in server mode */}
        {config.authEnabled && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        )}
        
        {/* Connection Status - Only show if not connected (WebSocket is optional for basic functionality) */}
        {connectionStatus !== 'connected' && showOfflineIndicator && (
          <div className={`
            flex items-center gap-2 px-2 py-1 rounded text-xs
            ${connectionStatus === 'connecting' ? 'text-yellow-400' : 'text-gray-400'}
          `}>
            <div className={`
              w-2 h-2 rounded-full
              ${connectionStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-gray-400'}
            `} />
            {connectionStatus === 'connecting' ? 'Connecting...' : 'WebSocket offline'}
          </div>
        )}
      </div>
    </nav>
  );
}

