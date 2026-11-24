import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import type { AuthStatus, User } from '../types';
import { ZyrquenEmblem } from './ZyrquenEmblem';

interface AuthGateProps {
  authStatus: AuthStatus;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthGate({ authStatus, onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'claim' | 'login' | 'register'>(
    authStatus.initialized ? 'login' : 'claim'
  );
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(nextMode: 'claim' | 'login' | 'register') {
    setMode(nextMode);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'register') {
      if (displayName.trim().length < 2) {
        setError('ชื่อที่แสดงต้องมีอย่างน้อย 2 ตัวอักษร');
        return;
      }
      if (password.length < 8) {
        setError('รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร');
        return;
      }
      if (password !== confirmPassword) {
        setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'claim') {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/claim-admin', {
          method: 'POST',
          body: { email, displayName, password, passcode },
        });
        onAuthenticated(res.token, res.user);
      } else if (mode === 'register') {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/register', {
          method: 'POST',
          body: { email, displayName, password, confirmPassword },
        });
        onAuthenticated(res.token, res.user);
      } else {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        onAuthenticated(res.token, res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ยืนยันตัวตนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-[#060A14] px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex flex-col items-start gap-4">
          <div className="flex items-center gap-3">
            <ZyrquenEmblem size={40} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-50">ZYRQUEN Ω∞</h1>
              <p className="text-xs text-slate-400">แอปพลิเคชันปัญญาประดิษฐ์แกนสมองอิสระ</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">
            {mode === 'claim'
              ? 'ยังไม่มีบัญชีผู้ดูแลระบบในฐานข้อมูล สามารถตั้งค่าผู้ดูแลระบบเริ่มต้น หรือเลือกสมัครสมาชิกเพื่อเข้าใช้งานได้ทันที'
              : mode === 'register'
                ? 'สมัครสมาชิกใหม่เพื่อใช้งานบทสนทนาที่บันทึกไว้ กราฟความรู้ส่วนตัว และระบบเวิร์กโฟลว์ภายใน'
                : 'เข้าสู่ระบบเพื่อใช้งานบทสนทนาที่บันทึกไว้ กราฟความรู้ภายใน และระบบเวิร์กโฟลว์'}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-6 sm:p-7">
          {authStatus.initialized ? (
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-[#070C18] p-1">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                เข้าสู่ระบบ
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`min-h-[44px] rounded-lg px-3 text-sm font-medium transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                สมัครสมาชิก
              </button>
            </div>
          ) : (
            <div
              className={`mb-6 grid gap-1 rounded-xl bg-[#070C18] p-1 ${
                authStatus.userCount > 0 ? 'grid-cols-3' : 'grid-cols-2'
              }`}
            >
              <button
                type="button"
                onClick={() => switchMode('claim')}
                className={`min-h-[44px] rounded-lg px-2.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  mode === 'claim'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ตั้งค่าผู้ดูแล
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`min-h-[44px] rounded-lg px-2.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                สมัครสมาชิก
              </button>
              {authStatus.userCount > 0 && (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={`min-h-[44px] rounded-lg px-2.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    mode === 'login'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  เข้าสู่ระบบ
                </button>
              )}
            </div>
          )}

          {mode === 'claim' && !authStatus.initialized && (
            <div className="mb-5 flex items-center gap-2.5 text-sm font-medium text-cyan-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>ตั้งค่าผู้ดูแลระบบเริ่มต้น</span>
            </div>
          )}

          {mode === 'register' && (
            <div className="mb-5 flex items-center gap-2.5 text-sm font-medium text-cyan-300">
              <UserPlus className="h-4 w-4 shrink-0" />
              <span>สมัครสมาชิกใหม่ (บัญชีผู้ใช้งานทั่วไป)</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {(mode === 'claim' || mode === 'register') && (
              <div>
                <label
                  htmlFor="zyrq-display-name"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  ชื่อที่แสดง
                </label>
                <input
                  id="zyrq-display-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={mode === 'claim' ? 'หัวหน้าทีมวิจัย' : 'ชื่อของคุณ (อย่างน้อย 2 ตัวอักษร)'}
                  className="h-12 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="zyrq-email"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                อีเมล
              </label>
              <input
                id="zyrq-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@zyrquen.local"
                className="h-12 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="zyrq-password"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                รหัสผ่าน
              </label>
              <div className="relative">
                <input
                  id="zyrq-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={256}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  className="h-12 w-full rounded-xl border border-slate-800 bg-[#070C18] pl-3.5 pr-11 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="zyrq-confirm-password"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  ยืนยันรหัสผ่าน
                </label>
                <input
                  id="zyrq-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่านซ้ำอีกครั้ง"
                  className="h-12 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            )}

            {mode === 'claim' && authStatus.envPasscodeConfigured && (
              <div>
                <label
                  htmlFor="zyrq-passcode"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300"
                >
                  <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                  <span>รหัสยืนยันการตั้งค่าเซิร์ฟเวอร์</span>
                </label>
                <input
                  id="zyrq-passcode"
                  type="password"
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="กรอก ZYRQUEN_ADMIN_PASSCODE ที่ตั้งไว้"
                  className="h-12 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                />
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-sm text-rose-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
            >
              <span>
                {loading
                  ? 'กำลังตรวจสอบ...'
                  : mode === 'claim'
                    ? 'ตั้งค่าผู้ดูแลและเข้าใช้งาน'
                    : mode === 'register'
                      ? 'สมัครสมาชิก'
                      : 'เข้าสู่ระบบ'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          แกนสมอง Python 3.11 ภายใน · ไม่เชื่อมต่อ LLM ภายนอก · เซสชันปลอดภัยในหน่วยความจำ
        </p>
      </div>
    </div>
  );
}
