import React from 'react';
import {
  ArrowLeft,
  BrainCircuit,
  Home,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
  User as UserIcon,
} from 'lucide-react';
import { useZyrquenTheme } from '../lib/theme';
import type { AppScreen, User } from '../types';
import { ZyrquenEmblem } from './ZyrquenEmblem';

interface AppShellProps {
  activeScreen: AppScreen;
  screenTitle: string;
  user: User;
  showBackOnMobile?: boolean;
  hideBottomBarOnMobile?: boolean;
  isProcessing?: boolean;
  onNavigate: (screen: AppScreen) => void;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenCommandPalette?: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ id: AppScreen; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'หน้าหลัก', icon: Home },
  { id: 'workspace', label: 'เวิร์กสเปซ', icon: MessageSquareText },
  { id: 'memory', label: 'ความจำ', icon: BrainCircuit },
  { id: 'settings', label: 'ตั้งค่า', icon: Settings },
];

export function AppShell({
  activeScreen,
  screenTitle,
  user,
  showBackOnMobile = false,
  hideBottomBarOnMobile = false,
  isProcessing = false,
  onNavigate,
  onBack,
  onOpenProfile,
  onOpenCommandPalette,
  children,
}: AppShellProps) {
  const { theme, toggleTheme } = useZyrquenTheme();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Compact Application Header: Mobile App Bar + Adaptive 3-Zone Desktop/Tablet Top Bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]/92 backdrop-blur-md">
        {/* Mobile Header (52px) */}
        <div className="flex h-[52px] items-center justify-between px-3 md:hidden">
          <div className="flex min-w-[44px] items-center">
            {showBackOnMobile ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="ย้อนกลับ"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('home')}
                aria-label="หน้าหลัก ZYRQUEN"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center"
              >
                <ZyrquenEmblem size={28} active={isProcessing} />
              </button>
            )}
          </div>

          <h1 className="max-w-[180px] truncate text-center text-sm font-semibold tracking-tight text-[var(--color-text)]">
            {screenTitle}
          </h1>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-[var(--color-accent)]" />
              ) : (
                <Moon className="h-4 w-4 text-[var(--color-primary)]" />
              )}
            </button>
            <button
              type="button"
              onClick={onOpenProfile}
              aria-label="โปรไฟล์บัญชี"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-xs font-semibold text-[var(--color-accent)]">
                {user.display_name.slice(0, 1).toUpperCase()}
              </div>
            </button>
          </div>
        </div>

        {/* Tablet & Desktop 3-Zone Header (60px) */}
        <div className="mx-auto hidden h-[60px] max-w-6xl items-center justify-between gap-8 px-6 md:flex">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex shrink-0 items-center gap-2.5 rounded-lg text-left whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
          >
            <ZyrquenEmblem size={28} active={isProcessing} />
            <span className="font-display text-base font-bold tracking-tight text-[var(--color-text)]">
              ZYRQUEN Ω∞
            </span>
          </button>

          <nav aria-label="เมนูหลัก" className="flex items-center gap-6">
            {NAV_ITEMS.map((item) => {
              const active = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span
                      className="zyrq-brand-gradient-line absolute inset-x-0 -bottom-[11px] h-[2px] rounded-full"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง (Light Mode)' : 'เปลี่ยนเป็นโหมดมืด (Dark Mode)'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-[var(--color-accent)]" />
              ) : (
                <Moon className="h-4 w-4 text-[var(--color-primary)]" />
              )}
            </button>

            {onOpenCommandPalette && (
              <button
                type="button"
                onClick={onOpenCommandPalette}
                aria-label="เปิดแผงคำสั่งด่วน (Ctrl+K)"
                className="flex h-10 items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)] whitespace-nowrap"
              >
                <span>⌘K</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenProfile}
              className="flex h-10 shrink-0 items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)] whitespace-nowrap"
            >
              <UserIcon className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span className="max-w-[120px] truncate">{user.display_name}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className={`flex min-h-0 flex-1 flex-col ${
          hideBottomBarOnMobile ? 'pb-0' : 'pb-[72px] md:pb-8'
        }`}
      >
        {children}
      </main>

      {/* Native-Feeling Mobile Bottom Navigation Bar */}
      {!hideBottomBarOnMobile && (
        <nav
          aria-label="แถบนำทางมือถือ"
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-md pb-safe md:hidden"
        >
          <div className="grid h-[56px] grid-cols-4 items-center">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[44px] flex-col items-center justify-center gap-1 transition-colors ${
                    active
                      ? 'text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-[11px] font-medium leading-none tracking-tight">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
