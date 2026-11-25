import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Download,
  FileCode2,
  FileText,
  FolderKanban,
  FolderSearch,
  Globe,
  History,
  ListChecks,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { ApiError, apiRequest } from '../lib/api';
import { detectPendingToolActivity, type ToolId } from '../lib/tools';
import type {
  ConversationSmartSummary,
  ConversationSummary,
  MessageItem,
  ModelVariantId,
  NativeTrace,
  ReasoningMode,
} from '../types';
import { CopyButton } from './CopyButton';
import { SafeMessageText, toPlainAssistantCopyText } from './SafeMessageText';
import { SpacetimeFabric } from './SpacetimeFabric';
import { TemporalIntelligenceCore } from './TemporalIntelligenceCore';

interface WorkspaceViewProps {
  token: string;
  userRole?: 'admin' | 'user';
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeTitle: string;
  messages: MessageItem[];
  loadingThread: boolean;
  sending: boolean;
  streamingContent?: string | null;
  error: string | null;
  autoExpandTrace?: boolean;
  defaultMode: ReasoningMode;
  defaultModelVariant?: ModelVariantId;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onSendMessage: (
    content: string,
    mode: ReasoningMode,
    attachment?: string,
    modelVariant?: ModelVariantId
  ) => Promise<void>;
  onOpenSettings?: () => void;
  onRefreshConversation?: () => Promise<void> | void;
  onRetryLast?: () => void;
}

interface SpeechRecognitionResultItemLike {
  isFinal?: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultItemLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

function parseTrace(traceJson: string | null): NativeTrace | null {
  if (!traceJson) return null;
  try {
    return JSON.parse(traceJson) as NativeTrace;
  } catch {
    return null;
  }
}

function splitUserAttachmentNotice(rawContent: string): {
  body: string;
  attachmentChars: number | null;
} {
  const match = rawContent.match(/\n\n\[Attachment:\s*(\d+)\s*chars\]\s*$/);
  if (!match) {
    return { body: rawContent, attachmentChars: null };
  }
  const body = rawContent.slice(0, match.index).trim();
  const chars = Number(match[1]);
  return {
    body: body === 'Attached snippet' ? 'ส่งไฟล์แนบเพื่อวิเคราะห์' : body,
    attachmentChars: Number.isFinite(chars) ? chars : null,
  };
}

function downloadArtifactFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  if (!content || typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getStatusMeta(status: string): {
  label: string;
  tone: 'verified' | 'approval' | 'blocked' | 'boundary' | 'neutral';
} | null {
  switch (status) {
    case 'VERIFIED':
    case 'COMPLETED':
      return { label: 'ดำเนินการและตรวจสอบแล้ว', tone: 'verified' };
    case 'PENDING_APPROVAL':
    case 'AWAITING_APPROVAL':
      return { label: 'รอการอนุมัติ', tone: 'approval' };
    case 'BLOCKED':
    case 'FAILED':
    case 'REJECTED':
      return { label: 'ไม่สามารถดำเนินการต่อได้', tone: 'blocked' };
    case 'NOT_LEARNED':
    case 'UNABLE_TO_INFER':
      return { label: 'ต้องการข้อมูลเพิ่มเติม', tone: 'boundary' };
    case 'UNDERSTOOD':
      return null;
    default:
      return null;
  }
}

export function WorkspaceView({
  token,
  userRole = 'user',
  conversations,
  activeConversationId,
  activeTitle,
  messages,
  loadingThread,
  sending,
  streamingContent,
  error,
  defaultMode,
  defaultModelVariant = 'zyrquen-omega-v1',
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onSendMessage,
  onRefreshConversation,
  onRetryLast,
}: WorkspaceViewProps) {
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [smartSummary, setSmartSummary] = useState<ConversationSmartSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechLang, setSpeechLang] = useState<'th-TH' | 'en-US'>('th-TH');
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [approvalFeedback, setApprovalFeedback] = useState<Record<string, string>>({});
  const [activeToolStatus, setActiveToolStatus] = useState<{
    toolId: ToolId | 'native_core';
    label: string;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseTextRef = useRef<string>('');
  const speechFinalizedRef = useRef<string>('');

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending, streamingContent]);

  useEffect(() => {
    if (!summaryOpen || !activeConversationId || messages.length === 0) {
      return;
    }
    let active = true;
    Promise.resolve().then(async () => {
      if (!active) return;
      setSummaryLoading(true);
      try {
        const res = await apiRequest<{ summary: ConversationSmartSummary }>(
          `/api/conversations/${activeConversationId}/summary`,
          { token }
        );
        if (active) setSmartSummary(res.summary);
      } catch {
        if (active) setSmartSummary(null);
      } finally {
        if (active) setSummaryLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [activeConversationId, messages.length, summaryOpen, token]);

  function handleStreamScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBottom(distanceFromBottom > 160);
  }

  function handleExportMessage(msg: MessageItem) {
    const plainText = toPlainAssistantCopyText(msg.content);
    downloadArtifactFile(
      `zyrquen-output-${msg.id.slice(0, 8)}.md`,
      plainText,
      'text/markdown;charset=utf-8'
    );
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && !attachment) || sending) return;
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
    }
    const contentToSend = trimmed;
    const attachmentContent = attachment?.content;
    setActiveToolStatus(detectPendingToolActivity(contentToSend, defaultMode));
    setInput('');
    setAttachment(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    try {
      await onSendMessage(contentToSend, defaultMode, attachmentContent, defaultModelVariant);
    } finally {
      setActiveToolStatus(null);
    }
  }

  async function handleStarterPrompt(text: string, mode: ReasoningMode) {
    if (sending) return;
    setActiveToolStatus(detectPendingToolActivity(text, mode));
    try {
      await onSendMessage(text, mode, undefined, defaultModelVariant);
    } finally {
      setActiveToolStatus(null);
    }
  }

  async function handleApprovalDecision(
    msgId: string,
    decision: 'approve' | 'reject',
    trace: NativeTrace | null
  ) {
    const invocationId = trace?.external_tool?.invocation_id;
    const missionId = trace?.autonomous_mission?.mission_id;
    if (!invocationId && !missionId) return;

    setApprovalBusyId(msgId);
    try {
      if (invocationId) {
        const res = await apiRequest<{ ok: boolean; status?: string }>(
          `/api/admin/tool-invocations/${invocationId}/decide`,
          {
            method: 'POST',
            token,
            body: { decision },
          }
        );
        setApprovalFeedback((prev) => ({
          ...prev,
          [msgId]:
            decision === 'approve'
              ? `อนุมัติแล้ว (${res.status || 'COMPLETED'})`
              : 'ปฏิเสธคำขอเรียบร้อยแล้ว',
        }));
      } else if (missionId) {
        if (decision === 'approve') {
          await apiRequest(`/api/autonomous/missions/${missionId}/resume`, {
            method: 'POST',
            token,
          });
          setApprovalFeedback((prev) => ({ ...prev, [msgId]: 'อนุมัติและดำเนินการต่อแล้ว' }));
        } else {
          await apiRequest(`/api/autonomous/missions/${missionId}/cancel`, {
            method: 'POST',
            token,
          });
          setApprovalFeedback((prev) => ({ ...prev, [msgId]: 'ยกเลิกคำขอเรียบร้อยแล้ว' }));
        }
      }
      if (onRefreshConversation) {
        await onRefreshConversation();
      }
    } catch (err) {
      setApprovalFeedback((prev) => ({
        ...prev,
        [msgId]: err instanceof ApiError ? err.message : 'ไม่สามารถบันทึกผลการอนุมัติได้',
      }));
    } finally {
      setApprovalBusyId(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setAttachment({ name: file.name, content: text.slice(0, 8000) });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleTextareaResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }

  function startSpeechRecognition(targetLang: 'th-TH' | 'en-US') {
    setSpeechError(null);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSpeechError('การรับเสียงต้องเชื่อมต่ออินเทอร์เน็ตเท่านั้น');
      return;
    }

    const SpeechCtor = getSpeechRecognitionCtor();
    if (!SpeechCtor) {
      setSpeechError('เบราว์เซอร์นี้ไม่รองรับ SpeechRecognition API');
      return;
    }

    try {
      const recognition = new SpeechCtor();
      recognition.lang = targetLang;
      recognition.interimResults = true;
      recognition.continuous = true;
      speechBaseTextRef.current = input.trim();
      speechFinalizedRef.current = '';

      recognition.onresult = (event) => {
        const startIdx = event.resultIndex ?? 0;
        let finalAdditions = '';
        let interimParts = '';
        for (let i = startIdx; i < event.results.length; i += 1) {
          const item = event.results[i];
          const text = item?.[0]?.transcript?.trim();
          if (!text) continue;
          if (item.isFinal === false) {
            interimParts = interimParts ? `${interimParts} ${text}` : text;
          } else {
            finalAdditions = finalAdditions ? `${finalAdditions} ${text}` : text;
          }
        }
        if (finalAdditions) {
          speechFinalizedRef.current = speechFinalizedRef.current
            ? `${speechFinalizedRef.current} ${finalAdditions}`
            : finalAdditions;
        }
        const combinedVoice = [speechFinalizedRef.current, interimParts].filter(Boolean).join(' ');
        const composed = [speechBaseTextRef.current, combinedVoice].filter(Boolean).join(' ');
        setInput(composed);
        window.requestAnimationFrame(() => {
          if (textareaRef.current) handleTextareaResize(textareaRef.current);
        });
      };

      recognition.onerror = (ev) => {
        setListening(false);
        const code = ev?.error || 'unknown';
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setSpeechError('กรุณาอนุญาตสิทธิ์ไมโครโฟนในเบราว์เซอร์');
        } else if (code === 'network') {
          setSpeechError('การถอดเสียงต้องเชื่อมต่ออินเทอร์เน็ต');
        } else if (code !== 'aborted' && code !== 'no-speech') {
          setSpeechError(`ไม่สามารถรับเสียงได้ (${code})`);
        }
      };

      recognition.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      setSpeechError('ไม่สามารถเริ่มต้น SpeechRecognition ได้');
    }
  }

  function handleToggleSpeech() {
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    startSpeechRecognition(speechLang);
  }

  return (
    <div className="relative flex h-[calc(100dvh-52px)] min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)] md:h-[calc(100dvh-60px)]">
      {/* Minimal Workspace Toolbar */}
      <header className="flex min-h-[48px] shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="เปิดประวัติโปรเจกต์"
            className="flex min-h-[40px] shrink-0 items-center gap-2 rounded-xl px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] whitespace-nowrap"
          >
            <History className="h-4 w-4 text-[var(--color-accent)]" aria-hidden="true" />
            <span>รายการงาน</span>
            <span className="text-[var(--color-text-muted)] tabular-nums">
              ({conversations.length})
            </span>
          </button>
          <span className="text-[var(--color-border)]" aria-hidden="true">
            /
          </span>
          <p
            title={activeTitle}
            className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text-secondary)] sm:max-w-[320px]"
          >
            {activeTitle}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {activeConversationId && messages.length > 0 && (
            <button
              type="button"
              onClick={() => setSummaryOpen((prev) => !prev)}
              aria-expanded={summaryOpen}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)] whitespace-nowrap"
            >
              <ListChecks className="h-4 w-4 text-[var(--color-accent)]" aria-hidden="true" />
              <span className="hidden sm:inline">สรุปผลลัพธ์</span>
              {summaryOpen ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onNewConversation}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-surface-hover)] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>เริ่มงานใหม่</span>
          </button>
        </div>
      </header>

      {/* Collapsible Smart Summary Panel */}
      {summaryOpen && activeConversationId && messages.length > 0 && (
        <section
          aria-label="สรุปประเด็นสำคัญอัตโนมัติ"
          className="max-h-[38dvh] shrink-0 overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:px-6"
        >
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--color-accent)]">
                Smart Summary — สรุปผลลัพธ์ยืนยันแล้ว
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {smartSummary && (
                  <span className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                    {smartSummary.metrics.verified_count} ยืนยัน ·{' '}
                    {smartSummary.metrics.not_learned_count} รอข้อมูลเพิ่ม
                  </span>
                )}
                {smartSummary && smartSummary.bullets.length > 0 && (
                  <CopyButton
                    getText={() =>
                      [
                        `สรุปผลลัพธ์ (${smartSummary.metrics.verified_count} ยืนยัน / ${smartSummary.metrics.not_learned_count} รอข้อมูลเพิ่ม)`,
                        ...smartSummary.bullets.map((b) => `- ${toPlainAssistantCopyText(b)}`),
                      ].join('\n')
                    }
                    ariaLabel="คัดลอกสรุปสำคัญ"
                    title="คัดลอกสรุปสำคัญทั้งหมด"
                    size="xs"
                  />
                )}
              </div>
            </div>
            {summaryLoading ? (
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                กำลังรวบรวมสรุปผลลัพธ์...
              </p>
            ) : smartSummary && smartSummary.bullets.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-text)]">
                {smartSummary.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    <div className="min-w-0 flex-1">
                      <SafeMessageText content={bullet} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                ยังไม่มีผลลัพธ์เชิงโครงสร้างในโปรเจกต์นี้
              </p>
            )}
          </div>
        </section>
      )}

      {/* Main Scrollable Conversation & Deliverables Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleStreamScroll}
        className="relative flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {loadingThread ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 text-sm text-[var(--color-text-secondary)]"
            >
              กำลังโหลดประวัติการทำงาน...
            </div>
          ) : messages.length === 0 ? (
            <div className="zyrq-glow relative my-2 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 sm:my-6 sm:p-8">
              <SpacetimeFabric density="minimal" className="pointer-events-none absolute inset-0" />
              <div className="relative z-10 flex flex-col items-start gap-5">
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  <TemporalIntelligenceCore
                    variant="compact"
                    size={84}
                    active={sending || streamingContent !== null}
                  />
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-[var(--color-text)] sm:text-xl">
                      พื้นที่ดำเนินงาน ZYRQUEN
                    </h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      พิมพ์คำสั่ง แนบไฟล์ หรือเลือกโปรเจกต์ด้านล่าง เพื่อวิเคราะห์ วางแผน และสร้างผลงานจริง
                    </p>
                  </div>
                </div>

                <div className="grid w-full gap-2.5 sm:grid-cols-2">
                  {[
                    {
                      label: 'พัฒนาซอฟต์แวร์',
                      text: 'วางแผนและออกแบบโครงสร้างโมดูลบริการ API พร้อมขั้นตอนทดสอบ',
                      m: 'plan' as ReasoningMode,
                    },
                    {
                      label: 'สร้างเอกสาร',
                      text: 'สร้างเอกสารสรุปสถาปัตยกรรมและรายการตรวจสอบความพร้อมระบบ',
                      m: 'auto' as ReasoningMode,
                    },
                    {
                      label: 'วิเคราะห์ข้อมูล',
                      text: 'คำนวณค่าเฉลี่ย ส่วนเบี่ยงเบนมาตรฐาน และตรวจสอบสมการ (144 / 12) + sqrt(81)',
                      m: 'math' as ReasoningMode,
                    },
                    {
                      label: 'แก้ปัญหา',
                      text: 'วางแผน: ตรวจสอบและวิเคราะห์ชุดข้อมูลหรือจุดคอขวดในเวิร์กสเปซ',
                      m: 'plan' as ReasoningMode,
                    },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={sending}
                      onClick={() => void handleStarterPrompt(q.text, q.m)}
                      className="min-h-[60px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 px-4 py-3 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                    >
                      <p className="text-xs font-semibold text-[var(--color-accent)]">{q.label}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text)]">{q.text}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const trace = !isUser ? parseTrace(msg.trace_json) : null;
              const statusMeta = !isUser ? getStatusMeta(msg.status) : null;
              const userParsed = isUser ? splitUserAttachmentNotice(msg.content) : null;
              const deliverable = trace?.deliverable;
              const needsApproval =
                !isUser &&
                (msg.status === 'PENDING_APPROVAL' || msg.status === 'AWAITING_APPROVAL');
              const canAdminApprove =
                needsApproval &&
                userRole === 'admin' &&
                Boolean(
                  trace?.external_tool?.invocation_id || trace?.autonomous_mission?.mission_id
                );
              const decidedText = approvalFeedback[msg.id];

              return (
                <article
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`select-text rounded-2xl px-4 py-3.5 ${
                      isUser
                        ? 'max-w-[90%] bg-[var(--color-primary)] text-white sm:max-w-[78%]'
                        : 'w-full max-w-[98%] border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)] sm:max-w-[90%]'
                    }`}
                  >
                    {!isUser && (
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)]/70 pb-2">
                        <span className="text-xs font-semibold tracking-wide text-[var(--color-accent)]">
                          ZYRQUEN
                        </span>
                        {statusMeta && (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                              statusMeta.tone === 'verified'
                                ? 'text-[var(--color-success)]'
                                : statusMeta.tone === 'approval'
                                  ? 'text-[var(--color-warning)]'
                                  : statusMeta.tone === 'blocked'
                                    ? 'text-[var(--color-danger)]'
                                    : 'text-[var(--color-text-secondary)]'
                            }`}
                          >
                            {statusMeta.tone === 'verified' ? (
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : statusMeta.tone === 'approval' ? (
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : statusMeta.tone === 'blocked' ? (
                              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>{statusMeta.label}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {isUser && userParsed ? (
                      <div className="space-y-2">
                        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                          {userParsed.body}
                        </p>
                        {userParsed.attachmentChars !== null && (
                          <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-[11px] text-white/95">
                            <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>ไฟล์แนบ ({userParsed.attachmentChars.toLocaleString()} ตัวอักษร)</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <SafeMessageText content={msg.content} />
                    )}

                    {/* Artifact / Deliverable Card when produced */}
                    {deliverable && deliverable.title && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <FileCode2
                            className="h-4 w-4 shrink-0 text-[var(--color-accent)]"
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-[var(--color-text)]">
                              {deliverable.title}
                            </p>
                            <p className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                              {deliverable.filename || deliverable.kind}
                              {deliverable.sha256 ? ` · ${deliverable.sha256.slice(0, 10)}` : ''}
                            </p>
                          </div>
                        </div>
                        {deliverable.content && (
                          <div className="flex items-center gap-1.5">
                            <CopyButton
                              getText={() => deliverable.content || ''}
                              label="คัดลอกผลงาน"
                              ariaLabel="คัดลอกเนื้อหาผลงาน"
                              size="xs"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                downloadArtifactFile(
                                  deliverable.filename || `zyrquen-artifact-${msg.id.slice(0, 6)}.md`,
                                  deliverable.content || '',
                                  deliverable.language === 'markdown'
                                    ? 'text/markdown;charset=utf-8'
                                    : 'text/plain;charset=utf-8'
                                )
                              }
                              aria-label="ดาวน์โหลดผลงาน"
                              className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                            >
                              <Download className="h-3 w-3" aria-hidden="true" />
                              <span>ดาวน์โหลด</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Inline Approval Gate Action when execution awaits confirmation */}
                    {needsApproval && (
                      <div
                        role="region"
                        aria-label="การอนุมัติคำสั่งงาน"
                        className="mt-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-surface)] p-3 text-xs"
                      >
                        {decidedText ? (
                          <p className="font-medium text-[var(--color-accent)]">{decidedText}</p>
                        ) : canAdminApprove ? (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[var(--color-text-secondary)]">
                              ขั้นตอนนี้อยู่ในคิวรออนุมัติ สามารถยืนยันเพื่อดำเนินการต่อได้ทันที
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={approvalBusyId === msg.id}
                                onClick={() => void handleApprovalDecision(msg.id, 'approve', trace)}
                                className="min-h-[34px] rounded-lg bg-[var(--color-primary)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                              >
                                อนุมัติและทำต่อ
                              </button>
                              <button
                                type="button"
                                disabled={approvalBusyId === msg.id}
                                onClick={() => void handleApprovalDecision(msg.id, 'reject', trace)}
                                className="min-h-[34px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-50"
                              >
                                ปฏิเสธ
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[var(--color-text-secondary)]">
                            รออนุมัติจากผู้ดูแลระบบก่อนดำเนินการขั้นถัดไป
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {!isUser && (
                    <div className="mt-1.5 flex w-full max-w-[98%] flex-wrap items-center gap-2 px-1 sm:max-w-[90%]">
                      <CopyButton
                        getText={() => toPlainAssistantCopyText(msg.content)}
                        ariaLabel="คัดลอกข้อความตอบกลับ"
                        title="คัดลอกผลลัพธ์ทั้งหมดเป็นข้อความธรรมดา"
                        size="sm"
                      />

                      <button
                        type="button"
                        onClick={() => handleExportMessage(msg)}
                        aria-label="ส่งออกผลลัพธ์เป็นไฟล์ Markdown"
                        title="ดาวน์โหลดเป็นไฟล์ .md"
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">ส่งออก .md</span>
                      </button>
                    </div>
                  )}
                </article>
              );
            })
          )}

          {sending && (
            <div className="flex flex-col items-start gap-2.5" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-xs font-medium text-[var(--color-accent)]">
                {activeToolStatus?.toolId === 'web_search' ? (
                  <Globe className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                ) : activeToolStatus?.toolId === 'doc_fetch' ? (
                  <FileText className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                ) : activeToolStatus?.toolId === 'workspace_file_read' ? (
                  <FolderSearch className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                ) : activeToolStatus?.toolId === 'calc_ast' ? (
                  <Calculator className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                ) : (
                  <Cpu className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
                )}
                <span>{activeToolStatus?.label || 'กำลังดำเนินการในพื้นที่ทำงาน...'}</span>
                <span className="hidden text-[11px] font-normal text-[var(--color-text-muted)] sm:inline">
                  · วิเคราะห์ · วางแผน · ดำเนินการ · ตรวจสอบผล
                </span>
              </div>
              {streamingContent && (
                <div className="w-full max-w-[98%] rounded-2xl border border-[var(--color-primary)]/40 bg-[var(--color-surface-raised)] px-4 py-3.5 text-[var(--color-text)] sm:max-w-[90%]">
                  <div className="mb-1.5 text-xs font-semibold tracking-wide text-[var(--color-accent)]">
                    ZYRQUEN
                  </div>
                  <SafeMessageText content={streamingContent} />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]"
            >
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton
                  getText={() => error}
                  ariaLabel="คัดลอกข้อความข้อผิดพลาด"
                  title="คัดลอกรายละเอียดข้อผิดพลาด"
                  size="xs"
                />
                {onRetryLast && (
                  <button
                    type="button"
                    onClick={onRetryLast}
                    className="min-h-[36px] shrink-0 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-surface-raised)] px-3 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)]"
                  >
                    ลองใหม่
                  </button>
                )}
              </div>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        {showScrollBottom && (
          <div className="sticky bottom-3 z-20 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={() => scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
              aria-label="เลื่อนลงล่างสุด"
              className="pointer-events-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]/95 px-3 py-1.5 text-xs font-medium text-[var(--color-text)] shadow-lg backdrop-blur-sm transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <ArrowDown className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden="true" />
              <span>เลื่อนลงล่างสุด</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom-Docked Clean Command Composer */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 pb-safe sm:px-6 sm:py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {/* Context Row: Project Selector & Attachment Preview */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <FolderKanban
                className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]"
                aria-hidden="true"
              />
              <select
                aria-label="เลือกโปรเจกต์"
                value={activeConversationId ?? '__new__'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__new__') {
                    onNewConversation();
                  } else {
                    onSelectConversation(val);
                  }
                }}
                className="max-w-[220px] truncate rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--color-text)] focus:border-[var(--color-focus)] focus:outline-none sm:max-w-[280px]"
              >
                <option value="__new__">+ โปรเจกต์ / งานใหม่</option>
                {conversations.map((conv) => (
                  <option key={conv.id} value={conv.id}>
                    {conv.title}
                  </option>
                ))}
              </select>
            </div>

            {attachment && (
              <div className="flex max-w-full items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-xs text-[var(--color-accent)]">
                <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  ไฟล์แนบ: {attachment.name} ({attachment.content.length.toLocaleString()} ตัวอักษร)
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="ลบไฟล์แนบ"
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {(speechError || listening) && (
            <div className="flex items-center justify-between gap-2 text-xs">
              {speechError ? (
                <span className="text-[var(--color-danger)]">{speechError}</span>
              ) : (
                <span className="text-[var(--color-accent)]">
                  กำลังฟังเสียง ({speechLang === 'th-TH' ? 'ภาษาไทย' : 'English'})...
                </span>
              )}
              {listening && (
                <button
                  type="button"
                  onClick={() => {
                    const nextLang = speechLang === 'th-TH' ? 'en-US' : 'th-TH';
                    setSpeechLang(nextLang);
                    recognitionRef.current?.stop();
                  }}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text)] hover:border-[var(--color-accent)]"
                >
                  {speechLang === 'th-TH' ? 'สลับ EN' : 'สลับ TH'}
                </button>
              )}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.json,.csv,.py,.ts,.tsx,.js,.jsx,.xml,.yaml,.yml,.sql,.html,.css,.log"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="แนบไฟล์ข้อความ"
              title="แนบไฟล์ข้อความ โค้ด หรือข้อมูล"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={handleToggleSpeech}
              aria-label={listening ? 'หยุดรับเสียง' : 'พิมพ์ด้วยเสียง (SpeechRecognition)'}
              aria-pressed={listening}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                listening
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]'
              }`}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                handleTextareaResize(e.target);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="พิมพ์คำสั่งงาน หรืออธิบายสิ่งที่ต้องการสร้าง..."
              aria-label="ช่องพิมพ์คำสั่งงาน"
              className="max-h-44 min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-[15px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-focus)] focus:outline-none"
            />

            <button
              type="submit"
              disabled={sending || (!input.trim() && !attachment)}
              aria-label="ส่งคำสั่งงาน"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--color-text-muted)]">
            <span>Enter เพื่อส่งคำสั่ง · Shift+Enter ขึ้นบรรทัดใหม่</span>
          </div>
        </form>
      </div>

      {/* Adaptive Project/Task History Sheet */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-stretch md:justify-start">
          <div
            className="flex max-h-[82dvh] w-full flex-col rounded-t-3xl border-t border-[var(--color-border)] bg-[var(--color-surface-raised)] md:h-full md:max-h-none md:w-80 md:rounded-none md:border-r md:border-t-0"
            role="dialog"
            aria-label="รายการโปรเจกต์และงาน"
          >
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-[var(--color-border)] md:hidden" />
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">รายการงานและโปรเจกต์</h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="ปิดรายการงาน"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3">
              <button
                type="button"
                onClick={() => {
                  onNewConversation();
                  setHistoryOpen(false);
                }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
              >
                <Plus className="h-4 w-4" />
                <span>เริ่มงานใหม่</span>
              </button>
            </div>

            <div className="flex-1 divide-y divide-[var(--color-border)] overflow-y-auto px-3 pb-6">
              {conversations.length === 0 ? (
                <p className="p-4 text-sm text-[var(--color-text-secondary)]">ยังไม่มีงานที่บันทึกไว้</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`flex items-center justify-between gap-2 rounded-xl px-2 py-2 ${
                      conv.id === activeConversationId ? 'bg-[var(--color-surface-hover)]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectConversation(conv.id);
                        setHistoryOpen(false);
                      }}
                      className="min-h-[44px] min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">{conv.title}</p>
                      <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                        {conv.message_count} รายการ
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteConversation(conv.id)}
                      aria-label={`ลบงาน ${conv.title}`}
                      className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
