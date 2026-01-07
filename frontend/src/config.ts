/**
 * Configuration for Sciplex frontend.
 * 
 * Environment variables (set via Vite):
 * - VITE_AUTH_ENABLED: 'true' or 'false' (default: 'true')
 * - VITE_API_URL: API base URL (default: 'http://localhost:8000')
 * - VITE_MULTI_USER: 'true' or 'false' (default: 'false')
 */

export const config = {
  // Authentication enabled (false for local mode, true for server mode)
  authEnabled: import.meta.env.VITE_AUTH_ENABLED !== 'false',
  
  // API base URL
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  
  // Multi-user mode (false for local, true for server)
  multiUser: import.meta.env.VITE_MULTI_USER === 'true',
  
  // WebSocket URL (derived from API URL)
  wsUrl: (() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const url = new URL(apiUrl);
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`;
  })(),
};

