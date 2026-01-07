import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useToast } from '../hooks/useToast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await login(email, password);
      toast.success('Login successful!');
      navigate('/');
    } catch (error: any) {
      toast.error(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a1a1e]">
      <div className="max-w-md w-full space-y-8 p-8 bg-[#252529] rounded-lg border border-[#3a3a3e]">
        <div>
          <div className="flex items-center justify-center gap-3 mb-4">
            <img 
              src="/sciplex.ico" 
              alt="Sciplex Flow" 
              className="w-10 h-10"
              style={{ imageRendering: 'auto' }}
            />
            <h2 className="text-3xl font-extrabold text-white">
              Sciplex Flow
            </h2>
          </div>
          <h3 className="mt-2 text-center text-xl font-semibold text-gray-300">
            Sign in to your account
          </h3>
          <p className="mt-2 text-center text-sm text-gray-400">
            Contact sales@sciplex.de to get access.
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email-address" className="sr-only">
                Email address
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-t-md relative block w-full px-3 py-2 border border-[#3a3a3e] bg-[#1a1a1e] placeholder-gray-500 text-white focus:outline-none focus:ring-[#06E4A8] focus:border-[#06E4A8] focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-b-md relative block w-full px-3 py-2 border border-[#3a3a3e] bg-[#1a1a1e] placeholder-gray-500 text-white focus:outline-none focus:ring-[#06E4A8] focus:border-[#06E4A8] focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-black bg-[#06E4A8] hover:bg-[#05c790] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#06E4A8] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

