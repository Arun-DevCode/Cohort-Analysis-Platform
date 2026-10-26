import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { usePlatformStore } from '@/store/usePlatformStore';
import {
  GraduationCap,
  Mail,
  Lock,
  User,
  Shield,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

interface AuthPageProps {
  onSuccess?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onSuccess }) => {
  const { loginToBackend, registerToBackend, backendConnected } = usePlatformStore();

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Submission & feedback state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    const result = await loginToBackend(loginEmail, loginPassword);
    setIsLoading(false);

    if (result.success) {
      setSuccessMessage('Welcome back! Loading your dashboard...');
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    } else {
      setErrorMessage(result.error || 'Invalid email or password.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!regName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (regPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);
    const result = await registerToBackend(regName.trim(), regEmail.trim(), regPassword);
    setIsLoading(false);

    if (result.success) {
      setSuccessMessage('Account created successfully! Redirecting to dashboard...');
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    } else {
      setErrorMessage(result.error || 'Registration failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 relative overflow-hidden font-sans">
      {/* Background Decorative Glow */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-in fade-in-50 zoom-in-95 duration-300">
        {/* Brand Header */}
        <div className="text-center mb-6 space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 text-white shadow-lg shadow-indigo-500/25 mb-1 ring-4 ring-indigo-500/20">
            <GraduationCap className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Student Progress Platform</h1>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Longitudinal LMS Analytics, Engagement Segmentation & Learner Intervention
          </p>
        </div>

        {/* Auth Card */}
        <Card className="bg-slate-900/90 border-slate-800 shadow-2xl backdrop-blur-xl text-slate-100 rounded-3xl">
          <CardHeader className="pb-3 text-center">
            <CardTitle className="text-xl font-bold text-white">
              {authMode === 'login' ? 'Sign In to Your Account' : 'Create New Account'}
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              {authMode === 'login'
                ? 'Enter your credentials to access student progress analytics'
                : 'Join the platform to track and analyze student cohorts'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Status alerts */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-xs flex items-start gap-2.5 animate-in fade-in-50 duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2.5 animate-in fade-in-50 duration-200">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Tabs for Login vs Register */}
            <Tabs
              value={authMode}
              onValueChange={(val) => {
                setAuthMode(val as 'login' | 'register');
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
            >
              <TabsList className="grid grid-cols-2 w-full bg-slate-800/80 border-slate-700/60 p-1 rounded-xl">
                <TabsTrigger
                  value="login"
                  className="rounded-lg text-xs py-2 data-[state=active]:bg-indigo-600 data-[state=active]:text-white font-medium"
                >
                  Sign In
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className="rounded-lg text-xs py-2 data-[state=active]:bg-indigo-600 data-[state=active]:text-white font-medium"
                >
                  Register
                </TabsTrigger>
              </TabsList>

              {/* === LOGIN TAB === */}
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-3.5 pt-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-slate-300">Email Address</Label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                      <Input
                        type="email"
                        required
                        placeholder="you@entri.app"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus-visible:ring-indigo-500 h-10 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-slate-300">Password</Label>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                      <Input
                        type={showLoginPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="pl-9 pr-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus-visible:ring-indigo-500 h-10 rounded-xl"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold h-10 rounded-xl shadow-md shadow-indigo-600/30 transition-all cursor-pointer mt-1"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Authenticating...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        Sign In to Dashboard <ArrowRight className="w-4 h-4" />
                      </span>
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* === REGISTER TAB === */}
              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-300">Full Name</Label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                      <Input
                        type="text"
                        required
                        placeholder="Dr. Sarah Connor"
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus-visible:ring-indigo-500 h-10 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-300">Email Address</Label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                      <Input
                        type="email"
                        required
                        placeholder="sarah@entri.app"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        className="pl-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus-visible:ring-indigo-500 h-10 rounded-xl"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-slate-300">Password</Label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3 pointer-events-none" />
                      <Input
                        type={showRegPassword ? 'text' : 'password'}
                        required
                        placeholder="At least 6 characters"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        className="pl-9 pr-9 bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus-visible:ring-indigo-500 h-10 rounded-xl"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-semibold h-10 rounded-xl shadow-md shadow-indigo-600/30 transition-all cursor-pointer mt-2"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating Account...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        Create Account & Proceed <ArrowRight className="w-4 h-4" />
                      </span>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>

          <CardFooter className="pt-0 pb-5 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 mt-2 pt-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  backendConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <span>{backendConnected ? 'API Connected' : 'Offline Mode'}</span>
            </div>
            <div className="flex items-center gap-1 text-slate-500">
              <Shield className="w-3 h-3" />
              <span>JWT + Argon2id Secured</span>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
