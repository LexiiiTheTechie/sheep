import React, { useState, useEffect } from 'react';
import { User, Lock, Sparkles, AlertCircle } from 'lucide-react';
import { authClient } from '../api/authClient';
import type { UserProfile } from '../types';

interface AuthModalProps {
  onAuthenticated: (user: UserProfile, token: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onAuthenticated }) => {
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function checkSetup() {
      try {
        const firstRun = await authClient.checkFirstRun();
        setIsFirstRun(firstRun);
        if (firstRun) {
          setIsLoginMode(false); // First run requires setup
        }
      } catch {
        setIsFirstRun(false);
      }
    }
    checkSetup();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setError(null);
    setIsLoading(true);

    try {
      if (isFirstRun) {
        // Setup initial Owner account
        const user = await authClient.setupOwner(username.trim(), password);
        const [_, token] = await authClient.login(username.trim(), password);
        onAuthenticated(user, token);
      } else if (isLoginMode) {
        // Normal login
        const [user, token] = await authClient.login(username.trim(), password);
        onAuthenticated(user, token);
      } else {
        // Register new standard user account
        const user = await authClient.setupOwner(username.trim(), password);
        const [_, token] = await authClient.login(username.trim(), password);
        onAuthenticated(user, token);
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto shadow-inner">
            <Sparkles className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-neutral-100">
            {isFirstRun ? 'Welcome to Sheep — Initial Setup' : (isLoginMode ? 'Sign in to Sheep' : 'Create an Account')}
          </h2>
          <p className="text-xs text-neutral-400 max-w-xs mx-auto">
            {isFirstRun
              ? 'Create the primary Administrator/Owner account to get started.'
              : 'Every user account has strictly isolated chats, presets, and model access.'}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1">Username</label>
            <div className="relative">
              <User className="w-4 h-4 text-neutral-500 absolute left-3 top-3" />
              <input
                type="text"
                required
                autoFocus
                placeholder="alice"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-500 absolute left-3 top-3" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !username.trim() || !password}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            {isLoading ? 'Processing...' : (isFirstRun ? 'Create Owner Account' : (isLoginMode ? 'Sign In' : 'Create Account'))}
          </button>
        </form>

        {!isFirstRun && (
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setIsLoginMode(!isLoginMode);
                setError(null);
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {isLoginMode ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
