import React, { useState } from 'react';
import { Modal } from '@/ui/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlatformStore } from '@/store/usePlatformStore';
import { Lock, Mail, User, LogOut, AlertCircle, CheckCircle2 } from 'lucide-react';

export const LoginModal: React.FC = () => {
  const {
    isLoginModalOpen,
    setLoginModalOpen,
    backendUser,
    backendConnected,
    loginToBackend,
    registerToBackend,
    logoutFromBackend,
  } = usePlatformStore();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    if (mode === 'register') {
      if (!name.trim()) {
        setErrorMsg('Please enter your full name');
        setIsLoading(false);
        return;
      }
      const res = await registerToBackend(name.trim(), email.trim(), password);
      setIsLoading(false);
      if (res.success) {
        setSuccessMsg('Account registered successfully!');
        setTimeout(() => setLoginModalOpen(false), 500);
      } else {
        setErrorMsg(res.error || 'Registration failed');
      }
    } else {
      const res = await loginToBackend(email.trim(), password);
      setIsLoading(false);
      if (res.success) {
        setSuccessMsg('Logged in successfully!');
        setTimeout(() => setLoginModalOpen(false), 500);
      } else {
        setErrorMsg(res.error || 'Invalid email or password');
      }
    }
  };

  const handleLogout = async () => {
    await logoutFromBackend();
    setLoginModalOpen(false);
  };

  return (
    <Modal
      isOpen={isLoginModalOpen}
      onClose={() => setLoginModalOpen(false)}
      title={backendUser ? 'Account Profile' : mode === 'login' ? 'Sign In to Backend' : 'Create Account'}
      description={
        backendUser
          ? 'Manage your active session and role permissions.'
          : 'Connect to the PostgreSQL API backend for real-time team synchronization.'
      }
      maxWidth="sm"
    >
      <div className="space-y-4 pt-1 font-sans">
        {/* Backend Connection Indicator */}
        <div
          className={`flex items-center justify-between p-3 rounded-xl border text-xs font-medium ${
            backendConnected
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                backendConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>
              {backendConnected ? 'Backend API Online (localhost:4000)' : 'Backend API Offline'}
            </span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider">
            {backendConnected ? 'Connected' : 'Offline'}
          </span>
        </div>

        {backendUser ? (
          <div className="p-4 rounded-2xl border border-border bg-card space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary font-bold text-lg border border-primary/20">
                {backendUser.name
                  ? backendUser.name.slice(0, 2).toUpperCase()
                  : backendUser.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-foreground">{backendUser.name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{backendUser.email}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-border flex justify-end">
              <Button variant="outline" size="sm" onClick={handleLogout} className="rounded-xl">
                <LogOut className="w-3.5 h-3.5 mr-1.5" /> Sign Out
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Mode Switcher */}
            <div className="grid grid-cols-2 p-1 bg-muted/60 rounded-xl border border-border/40 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
                className={`py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  mode === 'login'
                    ? 'bg-background text-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg(null);
                }}
                className={`py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                  mode === 'register'
                    ? 'bg-background text-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Register
              </button>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-xl bg-destructive/15 border border-destructive/30 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {mode === 'register' && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Full Name</Label>
                <div className="relative">
                  <User className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
                  <Input
                    type="text"
                    required
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-9 h-10 rounded-xl"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-medium">Email Address</Label>
              <div className="relative">
                <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
                <Input
                  type="email"
                  required
                  placeholder="admin@entri.app"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-10 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Password</Label>
              <div className="relative">
                <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
                <Input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-10 rounded-xl"
                />
              </div>
            </div>



            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 rounded-xl font-semibold shadow-sm cursor-pointer mt-2"
            >
              {isLoading
                ? 'Processing...'
                : mode === 'login'
                ? 'Sign In to Backend'
                : 'Create Account & Sign In'}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
};
