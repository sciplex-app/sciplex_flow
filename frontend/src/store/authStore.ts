import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { config } from '../config';

interface User {
  id: number;
  email: string;
  created_at?: string;
  is_active: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setAuth: (user: User, token: string) => void;
}

const API_URL = config.apiUrl;

// In local mode (no auth), auto-authenticate
const getInitialAuthState = () => {
  if (!config.authEnabled) {
    return {
      user: { id: 0, email: 'local@sciplex.local', is_active: true } as User,
      token: null,
      isAuthenticated: true,
    };
  }
  return {
    user: null,
    token: null,
    isAuthenticated: false,
  };
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...getInitialAuthState(),

      login: async (email: string, password: string) => {
        // In local mode, no login needed
        if (!config.authEnabled) {
          set(getInitialAuthState());
          return;
        }
        
        const response = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Login failed');
        }

        const data = await response.json();
        
        // Get user info
        const userResponse = await fetch(`${API_URL}/api/auth/me`, {
          headers: {
            'Authorization': `Bearer ${data.access_token}`,
          },
        });

        if (!userResponse.ok) {
          const errorData = await userResponse.json().catch(() => ({ detail: 'Unknown error' }));
          throw new Error(errorData.detail || 'Failed to get user information');
        }

        const user = await userResponse.json();

        set({
          user,
          token: data.access_token,
          isAuthenticated: true,
        });
      },

      register: async (email: string, password: string) => {
        const response = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Registration failed');
        }

        await response.json(); // User data not needed here

        // After registration, login the user
        await useAuthStore.getState().login(email, password);
      },

      logout: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
        });
      },

      setAuth: (user: User, token: string) => {
        set({
          user,
          token,
          isAuthenticated: true,
        });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user, 
        token: state.token, 
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
);

