import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  Command,
  Home,
  MessageSquarePlus,
  MessageSquareText,
  Search,
  Settings,
  Shield,
  Terminal,
  X,
} from 'lucide-react';
import Fuse from 'fuse.js';
import type { AppScreen, ConversationSummary, SettingsTab, User } from '../types';

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  keywords: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  user: User;
  conversations: ConversationSummary[];
  onClose: () => void;
  onNavigate: (screen: AppScreen, settingsTab?: SettingsTab) => void;
  onNewConversation: () => void;
  onOpenConversation: (conversationId: string) => void;
}

export function CommandPalette({
  open,
  user,
  conversations,
  onClose,
  onNavigate,
  onNewConversation,
  onOpenConversation,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      setQuery('');
      setSelectedIndex(0);
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const actions = useMemo<PaletteAction[]>(() => {
    const base: PaletteAction[] = [
      {
        id: 'new-conversation',
        label: 'เริ่มบทสนทนาใหม่ (New Conversation)',
        hint: 'Alt+N',
        keywords: 'new chat conversation workspace เริ่มใหม่ บทสนทนา',
        icon: MessageSquarePlus,
        onSelect: () => onNewConversation(),
      },
      {
        id: 'nav-home',
        label: 'ไปที่ หน้าหลัก (Home)',
        hint: 'Alt+1',
        keywords: 'home หน้าหลัก dashboard start',
        icon: Home,
        onSelect: () => onNavigate('home'),
      },
      {
        id: 'nav-workspace',
        label: 'ไปที่ เวิร์กสเปซ (Workspace)',
        hint: 'Alt+2',
        keywords: 'workspace เวิร์กสเปซ สนทนา chat ast',
        icon: MessageSquareText,
        onSelect: () => onNavigate('workspace'),
      },
      {
        id: 'nav-memory',
        label: 'ไปที่ ความจำและเวิร์กโฟลว์ (Memory & Workflows)',
        hint: 'Alt+3',
        keywords: 'memory workflow knowledge กราฟความรู้ เวิร์กโฟลว์',
        icon: BrainCircuit,
        onSelect: () => onNavigate('memory'),
      },
      {
        id: 'nav-settings-account',
        label: 'ไปที่ ตั้งค่าบัญชีผู้ใช้ (Account Settings)',
        hint: 'Alt+4',
        keywords: 'settings account ตั้งค่า บัญชี',
        icon: Settings,
        onSelect: () => onNavigate('settings', 'account'),
      },
      {
        id: 'nav-settings-dev',
        label: 'ไปที่ เครื่องมือนักพัฒนา (Developer & Evaluation)',
        hint: 'นักพัฒนา',
        keywords: 'developer api keys dataset evaluation นักพัฒนา ประเมินผล',
        icon: Terminal,
        onSelect: () => onNavigate('settings', 'developer'),
      },
    ];

    if (user.role === 'admin') {
      base.push({
        id: 'nav-settings-admin',
        label: 'ไปที่ ผู้ดูแลระบบ (Admin & Approval Gate)',
        hint: 'Admin',
        keywords: 'admin approval gate governance audit ผู้ดูแลระบบ อนุมัติ',
        icon: Shield,
        onSelect: () => onNavigate('settings', 'admin'),
      });
    }

    for (const conv of conversations.slice(0, 6)) {
      base.push({
        id: `conv-${conv.id}`,
        label: conv.title,
        hint: `${conv.mode} · ${conv.message_count} ข้อความ`,
        keywords: `conversation history บทสนทนา ${conv.title} ${conv.mode}`,
        icon: MessageSquareText,
        onSelect: () => onOpenConversation(conv.id),
      });
    }

    return base;
  }, [conversations, onNavigate, onNewConversation, onOpenConversation, user.role]);

  const fuse = useMemo(
    () =>
      new Fuse(actions, {
        keys: [
          { name: 'label', weight: 0.5 },
          { name: 'keywords', weight: 0.35 },
          { name: 'hint', weight: 0.15 },
        ],
        threshold: 0.42,
        ignoreLocation: true,
      }),
    [actions]
  );

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return actions;
    return fuse.search(trimmed).map((res) => res.item);
  }, [actions, fuse, query]);

  if (!open) return null;

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0
      );
      return;
    }
    if (e.key === 'Enter' && filtered[clampedIndex]) {
      e.preventDefault();
      filtered[clampedIndex].onSelect();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="แผงคำสั่งด่วน (Command Palette)"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0E172B] shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-cyan-300" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="พิมพ์คำสั่ง ข้ามหน้า หรือค้นหาบทสนทนา..."
            aria-label="ค้นหาคำสั่งด่วน"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดแผงคำสั่งด่วน"
            className="flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[55dvh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-400">
              ไม่พบคำสั่งที่ตรงกับ &ldquo;{query}&rdquo;
            </p>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === clampedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    item.onSelect();
                    onClose();
                  }}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    isSelected ? 'bg-blue-600/25 text-cyan-200' : 'text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-cyan-300" />
                    <span className="truncate text-sm font-medium">{item.label}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                    {item.hint}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-800/80 bg-[#070C18] px-4 py-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Command className="h-3 w-3 text-cyan-300" />
            <span>↑↓ เลือก · Enter เปิด · Esc ปิด</span>
          </span>
          <span className="font-mono">Ctrl+K / ⌘K</span>
        </div>
      </div>
    </div>
  );
}
