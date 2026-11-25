import React, { useEffect, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  MoreHorizontal,
  Moon,
  PenTool,
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

const NAV_ITEMS: Array<{
  id: AppScreen;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'ภาพรวม', icon: LayoutDashboard },
  { id: 'projects', label: 'โปรเจกต์', icon: FolderKanban },
  { id: 'tasks', label: 'งานของฉัน', icon: CheckSquare },
  { id: 'create', label: 'สร้างงาน', icon: PenTool },
  { id: 'analysis', label: 'วิเคราะห์', icon: BarChart3 },
  { id: 'artifacts', label: 'คลังผลงาน', icon: Archive },
];

// Mobile: 4 daily tabs in the bar, the rest under "เพิ่มเติม". Desktop keeps all of NAV_ITEMS.
const MOBILE_PRIMARY_IDS: AppScreen[] = ['overview', 'projects', 'create', 'tasks'];
const MOBILE_MORE_IDS: AppScreen[] = ['analysis', 'artifacts'];
const MOBILE_PRIMARY_ITEMS = MOBILE_PRIMARY_IDS.map(
  (id) => NAV_ITEMS.find((item) => item.id === id)!,
);
const MOBILE_MORE_ITEMS = MOBILE_MORE_IDS.map(
  (id) => NAV_ITEMS.find((item) => item.id === id)!,
);

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
  // The sheet belongs to the screen it was opened on, so it closes by itself when the screen changes.
  const [moreOpenAt, setMoreOpenAt] = useState<AppScreen | null>(null);
  const moreOpen = moreOpenAt === activeScreen;

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpenAt(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moreOpen]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Compact Workspace Header: Mobile App Bar + 3-Zone Desktop/Tablet Top Bar */}
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
                onClick={() => onNavigate('overview')}
                aria-label="ภาพรวม ZYRQUEN"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center"
              >
                <ZyrquenEmblem size={26} active={isProcessing} />
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
              aria-label="ตั้งค่า"
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
            onClick={() => onNavigate('overview')}
            className="flex shrink-0 items-center gap-2.5 rounded-lg text-left whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
          >
            <ZyrquenEmblem size={26} active={isProcessing} />
            <span className="font-display text-base font-bold tracking-tight text-[var(--color-text)]">
              ZYRQUEN
            </span>
          </button>

          <nav aria-label="เมนูหลัก" className="flex min-w-0 items-center gap-5 lg:gap-6">
            {NAV_ITEMS.map((item) => {
              const active =
                activeScreen === item.id ||
                (activeScreen === 'workspace' && item.id === 'projects') ||
                (activeScreen === 'memory' && item.id === 'tasks');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)] ${
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
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
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
                className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 font-mono text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)] whitespace-nowrap"
              >
                <span>⌘K</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onNavigate('settings')}
              aria-label="ตั้งค่า"
              className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                activeScreen === 'settings'
                  ? 'border-[var(--color-accent)] bg-[var(--color-surface-hover)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]'
              }`}
            >
              <Settings className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onOpenProfile}
              aria-label="โปรไฟล์ผู้ใช้และการตั้งค่า"
              className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-hover)] whitespace-nowrap"
            >
              <UserIcon className="h-3.5 w-3.5 text-[var(--color-accent)]" />
              <span className="max-w-[110px] truncate">{user.display_name}</span>
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

      {/* Mobile Bottom Navigation Bar: 4 daily tabs + "เพิ่มเติม" */}
      {!hideBottomBarOnMobile && (
        <>
          {moreOpen && (
            <>
              <button
                type="button"
                aria-label="ปิดเมนูเพิ่มเติม"
                onClick={() => setMoreOpenAt(null)}
                className="fixed inset-0 z-40 bg-black/40 md:hidden"
              />
              <div
                role="dialog"
                aria-label="เมนูเพิ่มเติม"
                className="fixed inset-x-0 bottom-[calc(56px_+_env(safe-area-inset-bottom,0px))] z-40 rounded-t-2xl border border-b-0 border-[var(--color-border)] bg-[var(--color-surface)] p-2 md:hidden"
              >
                {MOBILE_MORE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeScreen === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setMoreOpenAt(null);
                        onNavigate(item.id);
                      }}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                        active
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <nav
            aria-label="แถบนำทางมือถือ"
            className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-md pb-safe md:hidden"
          >
            <div className="grid h-[56px] grid-cols-5 items-center">
              {MOBILE_PRIMARY_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  activeScreen === item.id ||
                  (activeScreen === 'workspace' && item.id === 'projects') ||
                  (activeScreen === 'memory' && item.id === 'tasks');
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-[44px] flex-col items-center justify-center gap-1 px-0.5 transition-colors ${
                      active
                        ? 'text-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="max-w-full truncate text-[10px] font-medium leading-none tracking-tight">
                      {item.label}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setMoreOpenAt(moreOpen ? null : activeScreen)}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                className={`flex min-h-[44px] flex-col items-center justify-center gap-1 px-0.5 transition-colors ${
                  moreOpen || MOBILE_MORE_IDS.includes(activeScreen)
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                <MoreHorizontal className="h-4 w-4 shrink-0" />
                <span className="max-w-full truncate text-[10px] font-medium leading-none tracking-tight">
                  เพิ่มเติม
                </span>
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
