import React, { useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  Calculator,
  ChevronRight,
  Compass,
  Cpu,
  Globe,
  MessageSquareText,
  Sparkles,
  Workflow,
} from 'lucide-react';
import type {
  AppScreen,
  AutonomousMissionItem,
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
    label: 'ปฏิบัติการ 7 ขั้นตอน (Mission)',
    prompt: 'ภารกิจ: ค้นคว้าและพัฒนาองค์ความรู้เกี่ยวกับ SQLite',
    mode: 'auto',
  },
  {
    label: 'วางแผน DAG จากสถานะจริง',
    prompt: 'วางแผน: ตรวจสอบความจำ ฝึกโมเดล และประเมินผล',
    mode: 'plan',
  },
  {
    label: 'ทดสอบขอบเขตความซื่อสัตย์',
    prompt: 'อธิบายทฤษฎีที่ยังไม่ได้สอนในแกนความจำ',
    mode: 'auto',
  },
];

const ARCHITECTURE_PILLARS: Array<{
  id: string;
  title: string;
  detail: string;
  target: AppScreen;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}> = [
  {
    id: 'cognition',
    title: 'Autonomous Cognition',
    detail: 'คิด วิเคราะห์ ให้เหตุผล AST/สมการ/ตรรกะ และตัดสินใจด้วย Native Core โดยไม่พึ่ง LLM ภายนอก',
    target: 'workspace',
    icon: Calculator,
    accent: 'text-cyan-300',
  },
  {
    id: 'research',
    title: 'Autonomous Research',
    detail: 'ใช้อินเทอร์เน็ตค้นคว้าและตรวจสอบหลักฐานข้ามแหล่งแบบมีเกณฑ์ความน่าเชื่อถือ (ไม่ใช้แทนการคิด)',
    target: 'memory',
    icon: Globe,
    accent: 'text-blue-400',
  },
  {
    id: 'knowledge',
    title: 'Knowledge Development',
    detail: 'สร้างและพัฒนาองค์ความรู้ใหม่ลงกราฟ SQLite พร้อมตรวจข้อขัดแย้งและฝึก Checkpoint แยกเวอร์ชัน',
    target: 'memory',
    icon: BrainCircuit,
    accent: 'text-violet-400',
  },
  {
    id: 'planning',
    title: 'Planning & Execution',
    detail: 'วางแผน DAG และลงมือปฏิบัติการผ่านเครื่องมือที่ได้รับอนุญาตภายใต้ P5 Approval Gate',
    target: 'memory',
    icon: Workflow,
    accent: 'text-cyan-300',
  },
  {
    id: 'continuous',
    title: 'Continuous Operation',
    detail: 'ทำงานเชื่อมโยง 7 ขั้นตอน: Think → Discover → Learn → Plan → Act → Verify → Improve',
    target: 'memory',
    icon: Compass,
    accent: 'text-blue-300',
  },
  {
    id: 'interface',
    title: 'Conversation Interface',
    detail: 'เป็นเพียงช่องทางสื่อสารและสั่งงานเข้าสู่แกนสมองกลาง ไม่ใช่ตัวตนหรือขอบเขตของ AI',
    target: 'workspace',
    icon: MessageSquareText,
    accent: 'text-slate-300',
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

  function handleLaunchAutonomousLoop() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      onNavigate('memory');
      return;
    }
    const missionCmd = /^(?:ภารกิจ|ปฏิบัติการ|mission|autonomous)\s*:/i.test(trimmed)
      ? trimmed
      : `ภารกิจ: ${trimmed}`;
    onStartPrompt(missionCmd, 'auto');
    setPrompt('');
  }

  const recent: ConversationSummary[] = homeSummary?.recent_conversations || [];
  const recentMissions: AutonomousMissionItem[] = homeSummary?.recent_missions || [];
  const counts = homeSummary?.counts;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Identity, Greeting & Native Cognitive Core Status */}
      <section className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3.5">
          <ZyrquenEmblem size={44} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-cyan-300">
              ZYRQUEN Ω∞ · Autonomous General AI System (Native Cognitive Core)
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl text-balance">
              สวัสดี, {user.display_name}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
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

      {/* Primary Autonomous Command Entry Point */}
      <section className="mb-8 rounded-3xl border border-slate-800/90 bg-[#0E172B] p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="home-ai-input" className="text-sm font-medium text-slate-200">
              สั่งงานแกนสมอง ZYRQUEN Ω∞ · Think → Discover → Learn → Plan → Act → Verify → Improve
            </label>
            <div
              role="group"
              aria-label="โหมดการประมวลผล"
              className="flex flex-wrap items-center gap-1 rounded-xl bg-[#070C18] p-1"
            >
              {(
                [
                  { id: 'auto', label: 'อัตโนมัติ' },
                  { id: 'math', label: 'คณิต AST' },
                  { id: 'knowledge', label: 'กราฟความรู้' },
                  { id: 'plan', label: 'แผนงาน DAG' },
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
            placeholder="ระบุเป้าหมายภารกิจ (เช่น ภารกิจ: ค้นคว้าและสร้างองค์ความรู้...), โจทย์คณิตศาสตร์, แผนงาน DAG หรือสอนความจำภายใน..."
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

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleLaunchAutonomousLoop}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-[#070C18] px-4 text-xs font-semibold text-cyan-300 transition-colors hover:border-cyan-400 hover:bg-[#131F38] whitespace-nowrap"
              >
                <Sparkles className="h-4 w-4" />
                <span>{prompt.trim() ? 'รันวงจรอัตโนมัติ 7 ขั้น' : 'ศูนย์ปฏิบัติการต่อเนื่อง'}</span>
              </button>

              <button
                type="submit"
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 whitespace-nowrap"
              >
                <span>{prompt.trim() ? 'ส่งคำสั่งเข้าแกนสมอง' : 'เปิดเวิร์กสเปซ'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
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

      {/* Two-Column Adaptive Lower Grid: Operations/Channels + 6-Pillar Architecture */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {recentMissions.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-100">
                  ปฏิบัติการอัตโนมัติล่าสุด
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('memory')}
                  className="min-h-[36px] px-2 text-xs font-medium text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                >
                  ดูวงจร 7 ขั้นตอน
                </button>
              </div>
              <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] divide-y divide-slate-800/80">
                {recentMissions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onNavigate('memory')}
                    className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#131F38]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{m.goal}</p>
                      <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                        <span>{m.status}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{formatRelativeTime(m.created_at)}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-100">
                ช่องทางสื่อสารและสั่งงานล่าสุด
              </h3>
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
                <div className="p-6 text-sm text-slate-400">กำลังโหลดรายการเซสชัน...</div>
              ) : recent.length === 0 ? (
                <div className="flex flex-col items-start gap-3 p-6">
                  <p className="text-sm text-slate-300">
                    ยังไม่มีประวัติช่องทางสื่อสาร ระบุคำสั่งด้านบนหรือเลือกตัวอย่างเริ่มต้นเพื่อสั่งงานแกนสมอง
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
        </div>

        <section className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-100">
              องค์ประกอบ Autonomous General AI
            </h3>
            {counts && (
              <span className="text-xs text-slate-400 tabular-nums">
                {counts.triples} ความจำ · {counts.missions ?? 0} ภารกิจ · {counts.checkpoints} Ckpt
              </span>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {ARCHITECTURE_PILLARS.map((cap) => {
              const Icon = cap.icon;
              return (
                <button
                  key={cap.id}
                  type="button"
                  onClick={() => onNavigate(cap.target)}
                  className="flex min-h-[64px] items-start gap-3.5 rounded-2xl border border-slate-800/80 bg-[#0E172B] p-3.5 text-left transition-colors hover:border-slate-700 hover:bg-[#131F38]"
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

