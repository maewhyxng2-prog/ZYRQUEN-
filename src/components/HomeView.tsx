import React, { useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Calculator,
  ChevronRight,
  Cpu,
  Layers,
  MessageSquareText,
  Workflow,
} from 'lucide-react';
import type {
  AppScreen,
  ConversationSummary,
  HomeSummary,
  ReasoningMode,
  User,
} from '../types';
import { ZyrquenEmblem } from './ZyrquenEmblem';

interface HomeViewProps {
  user: User;
  homeSummary: HomeSummary | null;
  nativeReady: boolean;
  loading: boolean;
  error: string | null;
  onStartPrompt: (prompt: string, mode: ReasoningMode) => void;
  onOpenConversation: (conversationId: string) => void;
  onNavigate: (screen: AppScreen) => void;
  onRetry: () => void;
}

const STARTER_PROMPTS: Array<{ label: string; prompt: string; mode: ReasoningMode }> = [
  {
    label: 'คำนวณ AST เชิงสัญลักษณ์',
    prompt: 'คำนวณ (2^12 - 96) / 16',
    mode: 'math',
  },
  {
    label: 'สอนความจำภายใน',
    prompt: 'สอน: ZYRQUEN -> ใช้งาน -> แกนสมอง Python ภายใน',
    mode: 'knowledge',
  },
  {
    label: 'ค้นหากราฟความรู้',
    prompt: 'ZYRQUEN ใช้งานอะไร',
    mode: 'knowledge',
  },
  {
    label: 'ทดสอบขอบเขตความซื่อสัตย์',
    prompt: 'อธิบายทฤษฎีที่ยังไม่ได้สอนในแกนความจำ',
    mode: 'auto',
  },
];

const CAPABILITIES = [
  {
    id: 'math',
    title: 'การให้เหตุผลคณิตศาสตร์ AST',
    detail: 'วิเคราะห์นิพจน์เชิงสัญลักษณ์พร้อมแสดงลำดับขั้นการคำนวณจริงทุกขั้นตอน',
    icon: Calculator,
    accent: 'text-cyan-300',
  },
  {
    id: 'knowledge',
    title: 'กราฟความรู้และเส้นทางหลายช่วง BFS',
    detail: 'จัดเก็บความสัมพันธ์ถาวร ตรวจจับข้อขัดแย้ง และค้นหาเส้นทางเชื่อมโยงสูงสุด 4 ช่วง',
    icon: BrainCircuit,
    accent: 'text-blue-400',
  },
  {
    id: 'model',
    title: 'Checkpoint ภาษาไทยและ N-Gram แยกเวอร์ชัน',
    detail: 'ตัดพยางค์ภาษาไทยและฝึกโมเดลบน Train/Val/Test โดยไม่เขียนทับของเดิม',
    icon: Layers,
    accent: 'text-violet-400',
  },
  {
    id: 'workflows',
    title: 'วางแผนงาน DAG และเวิร์กโฟลว์ 8 กลุ่ม',
    detail: 'แตกขั้นตอนจากสถานะฐานข้อมูลจริงและประเมินผลเทียบ Baseline ภายใต้ Approval Gate',
    icon: Workflow,
    accent: 'text-cyan-300',
  },
];

function formatRelativeTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
}

export function HomeView({
  user,
  homeSummary,
  nativeReady,
  loading,
  error,
  onStartPrompt,
  onOpenConversation,
  onNavigate,
  onRetry,
}: HomeViewProps) {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<ReasoningMode>('auto');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      onNavigate('workspace');
      return;
    }
    onStartPrompt(trimmed, mode);
    setPrompt('');
  }

  const recent: ConversationSummary[] = homeSummary?.recent_conversations || [];
  const counts = homeSummary?.counts;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Identity, Greeting & Subtle Native Availability */}
      <section className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3.5">
          <ZyrquenEmblem size={44} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-cyan-300">
              ZYRQUEN Ω∞ · ปัญญาประดิษฐ์ทั่วไปแกนสมองอิสระ
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl text-balance">
              สวัสดี, {user.display_name}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Cpu className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <span>{nativeReady ? 'แกนสมองภายในพร้อมใช้งาน' : 'กำลังตรวจสอบแกนสมอง'}</span>
          {homeSummary?.system?.python_version && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Python {homeSummary.system.python_version}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>ไม่ใช้ LLM ภายนอก</span>
        </div>
      </section>

      {/* Primary AI Interaction Entry Point */}
      <section className="mb-8 rounded-3xl border border-slate-800/90 bg-[#0E172B] p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="home-ai-input" className="text-sm font-medium text-slate-200">
              ถาม คำนวณ หรือสอนความจำให้ ZYRQUEN
            </label>
            <div
              role="group"
              aria-label="โหมดการประมวลผล"
              className="flex items-center gap-1 rounded-xl bg-[#070C18] p-1"
            >
              {(
                [
                  { id: 'auto', label: 'อัตโนมัติ' },
                  { id: 'math', label: 'คณิต AST' },
                  { id: 'knowledge', label: 'กราฟความรู้' },
                  { id: 'model', label: 'Checkpoint' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`min-h-[36px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    mode === m.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            id="home-ai-input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="พิมพ์โจทย์คณิตศาสตร์ สอนความรู้ใหม่ (เช่น สอน: ก -> เกี่ยวข้อง -> ข) หรือค้นหาความจำภายใน..."
            className="w-full resize-none rounded-2xl border border-slate-800 bg-[#070C18] px-4 py-3 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => onStartPrompt(starter.prompt, starter.mode)}
                  className="min-h-[40px] rounded-xl border border-slate-800 bg-[#090F1E] px-3 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-200 whitespace-nowrap"
                >
                  {starter.label}
                </button>
              ))}
            </div>

            <button
              type="submit"
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
            >
              <span>{prompt.trim() ? 'ถาม ZYRQUEN' : 'เปิดเวิร์กสเปซ'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] rounded-lg bg-rose-500/20 px-3 text-xs font-medium text-rose-100 hover:bg-rose-500/30"
          >
            ลองใหม่
          </button>
        </div>
      )}

      {/* Two-Column Adaptive Lower Grid: Recent Conversations + Native Capabilities */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-100">บทสนทนาล่าสุด</h3>
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className="min-h-[40px] px-2 text-xs font-medium text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
            >
              ดูเวิร์กสเปซ
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] divide-y divide-slate-800/80">
            {loading && !homeSummary ? (
              <div className="p-6 text-sm text-slate-400">กำลังโหลดรายการบทสนทนา...</div>
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-start gap-3 p-6">
                <p className="text-sm text-slate-300">
                  ยังไม่มีบทสนทนา พิมพ์คำสั่งด้านบนหรือเลือกตัวอย่างเริ่มต้นเพื่อเปิดเซสชันแรก
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('workspace')}
                  className="min-h-[40px] rounded-xl bg-slate-800 px-4 text-xs font-medium text-slate-100 hover:bg-slate-700"
                >
                  เปิดเวิร์กสเปซเปล่า
                </button>
              </div>
            ) : (
              recent.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onOpenConversation(conv.id)}
                  className="flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-[#131F38]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#070C18] text-blue-400">
                    <MessageSquareText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{conv.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                      <span>{conv.mode}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{conv.message_count} ข้อความ</span>
                      <span aria-hidden="true"> · </span>
                      <span>{formatRelativeTime(conv.updated_at)}</span>
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                </button>
              ))
            )}
          </div>
        </section>

        <section className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-100">ความสามารถแกนสมองภายใน</h3>
            {counts && (
              <span className="text-xs text-slate-400 tabular-nums">
                {counts.triples} ความจำ · {counts.checkpoints} Checkpoint
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon;
              return (
                <button
                  key={cap.id}
                  type="button"
                  onClick={() =>
                    cap.id === 'workflows' || cap.id === 'knowledge'
                      ? onNavigate('memory')
                      : onNavigate('workspace')
                  }
                  className="flex min-h-[68px] items-start gap-3.5 rounded-2xl border border-slate-800/80 bg-[#0E172B] p-4 text-left transition-colors hover:border-slate-700 hover:bg-[#131F38]"
                >
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#070C18]">
                    <Icon className={`h-4 w-4 ${cap.accent}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-100">{cap.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{cap.detail}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
