import React, { useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  ChevronRight,
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
import { SpacetimeFabric } from './SpacetimeFabric';
import { TemporalIntelligenceCore } from './TemporalIntelligenceCore';

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

const PILLARS = [
  {
    code: 'Cognition',
    title: 'การรับรู้',
    detail: 'รับเป้าหมาย วิเคราะห์บริบท และจำแนกโครงสร้างปัญหา',
    accent: 'var(--zyrquen-cyan)',
  },
  {
    code: 'Knowledge',
    title: 'องค์ความรู้',
    detail: 'เชื่อมโยงกราฟความรู้ถาวร ตรวจจับข้อขัดแย้ง และบันทึกหลักฐาน',
    accent: 'var(--zyrquen-blue)',
  },
  {
    code: 'Reasoning',
    title: 'การให้เหตุผล',
    detail: 'คำนวณ AST วางแผน DAG และงดตอบเดาเมื่อยังไม่ได้เรียนรู้',
    accent: 'var(--zyrquen-violet)',
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
  nativeReady: _nativeReady,
  loading,
  error,
  onStartPrompt,
  onOpenConversation,
  onNavigate,
  onRetry,
}: HomeViewProps) {
  const [prompt, setPrompt] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) {
      onNavigate('workspace');
      return;
    }
    onStartPrompt(trimmed, 'auto');
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

  const recent: ConversationSummary[] = (homeSummary?.recent_conversations || []).slice(0, 5);
  const recentMissions: AutonomousMissionItem[] = (homeSummary?.recent_missions || []).slice(0, 3);
  const counts = homeSummary?.counts;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      {/* Neural Aurora Hero Showcase with Temporal Core & Expansive Spacetime Fabric */}
      <section className="zyrq-glow relative mb-6 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 sm:p-7">
        <SpacetimeFabric density="expansive" className="absolute inset-0" />
        <div
          className="zyrq-brand-gradient-line absolute inset-x-0 top-0 h-[2px] opacity-85"
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="shrink-0 self-center sm:self-auto">
              <TemporalIntelligenceCore variant="compact" size={136} active={loading} />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-semibold tracking-[0.18em] text-[var(--color-accent)] uppercase">
                ZYRQUEN · AUTONOMOUS FOUNDATIONAL INTELLIGENCE
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text)] sm:text-3xl text-balance">
                สวัสดี, {user.display_name}
              </h2>
              <p className="mt-1 text-sm font-medium text-[var(--color-text-secondary)]">
                ปัญญาที่พัฒนาได้ — ระบบประมวลผล เรียนรู้ วิเคราะห์ และสร้างองค์ความรู้
              </p>
              <p className="mt-2 text-xs font-medium text-[var(--color-text-muted)]">
                การรับรู้ · การเรียนรู้ · วิวัฒนาการของความรู้ · การให้เหตุผล · การพัฒนาตนเอง
              </p>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3 lg:w-[460px] lg:shrink-0">
            {PILLARS.map((pillar) => (
              <div
                key={pillar.code}
                className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/85 p-3 backdrop-blur-sm"
              >
                <p
                  className="font-mono text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: pillar.accent }}
                >
                  {pillar.code}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-[var(--color-text)]">
                  {pillar.title}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--color-text-secondary)]">
                  {pillar.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Task-first workspace entry point */}
      <section className="mb-8 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">WORKSPACE</p>
            <h3 className="mt-1 text-xl font-semibold text-[var(--color-text)] sm:text-2xl">คุณต้องการทำงานอะไร?</h3>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">เริ่มโปรเจกต์ใหม่ วิเคราะห์โจทย์ หรือดำเนินงานต่อจากสิ่งที่ทำค้างไว้</p>
          </div>
          <button type="button" onClick={() => onNavigate('workspace')} className="min-h-[40px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)]">
            เปิดพื้นที่ทำงาน <ArrowRight className="ml-1 inline h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'พัฒนาซอฟต์แวร์', detail: 'สร้างหรือแก้ไขโค้ดและโปรเจกต์', prompt: 'ช่วยตรวจสอบโครงสร้างโปรเจกต์และวางแผนพัฒนาซอฟต์แวร์', icon: 'code' },
            { label: 'วิเคราะห์ข้อมูล', detail: 'ตรวจสอบข้อมูลและสรุปผล', prompt: 'ช่วยวิเคราะห์ข้อมูลที่ฉันให้ พร้อมแสดงวิธีตรวจสอบผล', icon: 'chart' },
            { label: 'แก้โจทย์และปัญหา', detail: 'วิเคราะห์สาเหตุและหาทางแก้', prompt: 'ช่วยวิเคราะห์โจทย์นี้ แยกขั้นตอนและตรวจสอบคำตอบ', icon: 'solve' },
            { label: 'วางแผนโครงการ', detail: 'แตกงานเป็นขั้นตอนและติดตามผล', prompt: 'ช่วยวางแผนโครงการ แยกงานย่อยและสิ่งที่ต้องตรวจสอบ', icon: 'plan' },
          ].map((item) => (
            <button key={item.label} type="button" onClick={() => onStartPrompt(item.prompt, 'auto')} className="group flex min-h-[112px] flex-col items-start rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]">
              <span className="text-sm font-semibold text-[var(--color-text)]">{item.label}</span>
              <span className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{item.detail}</span>
              <span className="mt-auto pt-3 text-xs font-medium text-[var(--color-accent)]">เริ่มงาน <ArrowRight className="ml-1 inline h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 sm:p-5">
          <label htmlFor="home-ai-input" className="text-sm font-semibold text-[var(--color-text)]">กำหนดเป้าหมายของงาน</label>
          <textarea id="home-ai-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }} placeholder="อธิบายสิ่งที่ต้องการสร้าง วิเคราะห์ หรือแก้ไข..." className="mt-3 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[15px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-focus)] focus:outline-none" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">ZYRQUEN จะรับเป้าหมายและเริ่มกระบวนการทำงานตามความสามารถที่ระบบรองรับ</p>
            <button type="submit" className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]">
              เริ่มดำเนินงาน <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[40px] rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-surface-raised)] px-3 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)]"
          >
            ลองใหม่
          </button>
        </div>
      )}

      {/* Clean Two-Column Lower Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {recentMissions.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--color-text)]">
                  งานที่ดำเนินการล่าสุด
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate('memory')}
                  className="min-h-[36px] px-2 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] whitespace-nowrap"
                >
                  ดูทั้งหมด
                </button>
              </div>
              <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
                {recentMissions.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onNavigate('memory')}
                    className="flex min-h-[54px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">{m.goal}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
                        <span>{m.status}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{formatRelativeTime(m.created_at)}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                งานล่าสุด
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('workspace')}
                className="min-h-[36px] px-2 text-xs font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] whitespace-nowrap"
              >
                ดูงานทั้งหมด
              </button>
            </div>

            <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
              {loading && !homeSummary ? (
                <div className="p-6 text-sm text-[var(--color-text-secondary)]">กำลังโหลดรายการเซสชัน...</div>
              ) : recent.length === 0 ? (
                <div className="flex flex-col items-start gap-3 p-6">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    ยังไม่มีงานก่อนหน้า เริ่มกำหนดเป้าหมายงานแรกได้จากด้านบน
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('workspace')}
                    className="min-h-[38px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                  >
                    เปิดพื้นที่ทำงาน
                  </button>
                </div>
              ) : (
                recent.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onOpenConversation(conv.id)}
                    className="flex min-h-[58px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-primary)]">
                      <MessageSquareText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">{conv.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] tabular-nums">
                        <span>{conv.mode}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{conv.message_count} ข้อความ</span>
                        <span aria-hidden="true"> · </span>
                        <span>{formatRelativeTime(conv.updated_at)}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-[var(--color-text)]">
              สรุปสถานะการพัฒนาและความรู้
            </h3>
          </div>

          <div className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5">
            <div className="grid grid-cols-2 gap-3 tabular-nums">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="text-[11px] text-[var(--color-text-secondary)]">ความรู้ในกราฟ (KG)</p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {counts?.triples ?? 0}{' '}
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">รายการ</span>
                </p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="text-[11px] text-[var(--color-text-secondary)]">ชุดข้อมูลจริง</p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {counts?.datasets ?? 0}{' '}
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">ชุด</span>
                </p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="text-[11px] text-[var(--color-text-secondary)]">Model Checkpoints</p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">
                  {counts?.checkpoints ?? 0}{' '}
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">รุ่น</span>
                </p>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                <p className="text-[11px] text-[var(--color-text-secondary)]">รออนุมัติ (Gate)</p>
                <p className="mt-1 text-lg font-semibold text-[var(--zyrquen-violet)]">
                  {counts?.pending_approvals ?? 0}{' '}
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">รายการ</span>
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-xs text-[var(--color-text-secondary)]">
              ตัวเลขทั้งหมดสะท้อนข้อมูลจริงในพื้นที่ทำงาน และแยกสถานะการทดสอบออกจากหน้าผู้ดูแลระบบ
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('memory')}
                className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]"
              >
                <BrainCircuit className="h-4 w-4 text-[var(--color-accent)]" />
                <span>ความจำ &amp; DAG</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]"
              >
                <Workflow className="h-4 w-4 text-[var(--color-primary)]" />
                <span>ตั้งค่า &amp; Training</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
