import React, { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  FileText,
  FolderSearch,
  Globe,
  History,
  ListChecks,
  Mic,
  MicOff,
  Paperclip,
  Plus,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { redactSensitiveData } from '../lib/clipboard';
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
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeTitle: string;
  messages: MessageItem[];
  loadingThread: boolean;
  sending: boolean;
  streamingContent?: string | null;
  error: string | null;
  autoExpandTrace: boolean;
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

export function WorkspaceView({
  token,
  conversations,
  activeConversationId,
  activeTitle,
  messages,
  loadingThread,
  sending,
  streamingContent,
  error,
  autoExpandTrace,
  defaultMode,
  defaultModelVariant = 'zyrquen-omega-v1',
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onSendMessage,
  onOpenSettings,
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
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});
  const [activeToolStatus, setActiveToolStatus] = useState<{
    toolId: ToolId | 'native_core';
    label: string;
  } | null>(null);
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
  }, [messages.length, sending]);

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

  function toggleTrace(msgId: string) {
    setExpandedTraces((prev) => ({
      ...prev,
      [msgId]: !(prev[msgId] ?? autoExpandTrace),
    }));
  }

  function handleExportMessage(msg: MessageItem) {
    const plainText = toPlainAssistantCopyText(msg.content);
    if (!plainText || typeof document === 'undefined' || typeof URL === 'undefined') return;
    const blob = new Blob([plainText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyrquen-output-${msg.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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
      {/* Compact Workspace Toolbar */}
      <div className="flex min-h-[48px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="เปิดประวัติโปรเจกต์"
            className="flex min-h-[40px] items-center gap-2 rounded-xl px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] whitespace-nowrap"
          >
            <History className="h-4 w-4 text-[var(--color-accent)]" />
            <span>รายการงาน</span>
            <span className="text-[var(--color-text-muted)] tabular-nums">({conversations.length})</span>
          </button>
          <span className="hidden text-[var(--color-border)] sm:inline" aria-hidden="true">
            /
          </span>
          <p className="hidden max-w-[280px] truncate text-xs font-medium text-[var(--color-text-secondary)] sm:block">
            {activeTitle}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {activeConversationId && messages.length > 0 && (
            <button
              type="button"
              onClick={() => setSummaryOpen((prev) => !prev)}
              aria-expanded={summaryOpen}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)] whitespace-nowrap"
            >
              <ListChecks className="h-4 w-4 text-[var(--color-accent)]" />
              <span className="hidden sm:inline">สรุปผลลัพธ์</span>
              {summaryOpen ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onNewConversation}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-surface-hover)] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>เริ่มงานใหม่</span>
          </button>
        </div>
      </div>

      {/* Collapsible Smart Summary Panel */}
      {summaryOpen && activeConversationId && messages.length > 0 && (
        <section
          aria-label="สรุปประเด็นสำคัญอัตโนมัติ"
          className="max-h-[38dvh] shrink-0 overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 sm:px-6"
        >
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--color-accent)]">
                Smart Summary · ประเด็นและผลลัพธ์ยืนยันแล้ว
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
                        `Smart Summary (${smartSummary.metrics.verified_count} ยืนยัน / ${smartSummary.metrics.not_learned_count} รอข้อมูลเพิ่ม)`,
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
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">กำลังสรุปผลลัพธ์ภายใน...</p>
            ) : smartSummary && smartSummary.bullets.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-text)]">
                {smartSummary.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
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

      {/* Scrollable Task Execution Log */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {loadingThread ? (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-sm text-[var(--color-text-secondary)]">
              กำลังโหลดข้อมูลงาน...
            </div>
          ) : messages.length === 0 ? (
            <div className="zyrq-glow relative my-4 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-5 sm:my-6 sm:p-8">
              <SpacetimeFabric density="minimal" className="pointer-events-none absolute inset-0" />
              <div className="relative z-10 flex flex-col items-start gap-5">
                <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                  <TemporalIntelligenceCore
                    variant="compact"
                    size={90}
                    active={sending || streamingContent !== null}
                  />
                  <div>
                    <h2 className="text-lg font-bold text-[var(--color-text)]">
                      พื้นที่ดำเนินงาน ZYRQUEN
                    </h2>
                    <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      อธิบายเป้าหมาย แนบไฟล์ข้อมูล หรือซอร์สโค้ด เพื่อให้ระบบวิเคราะห์ วางแผน และสร้างผลงานจริง
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                      Web Workspace Client เชื่อมต่อ Python Core (แยกจากแอป Native Android/Desktop)
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
                      onClick={async () => {
                        setActiveToolStatus(detectPendingToolActivity(q.text, q.m));
                        try {
                          await onSendMessage(q.text, q.m, undefined, defaultModelVariant);
                        } finally {
                          setActiveToolStatus(null);
                        }
                      }}
                      className="min-h-[56px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 px-4 py-3 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]"
                    >
                      <p className="text-xs font-semibold text-[var(--color-accent)]">{q.label}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-text)]">{q.text}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const trace = !isUser ? parseTrace(msg.trace_json) : null;
              const isTraceOpen = expandedTraces[msg.id] ?? autoExpandTrace;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`select-text max-w-[94%] sm:max-w-[85%] rounded-2xl px-4 py-3.5 ${
                      isUser
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text)]'
                    }`}
                  >
                    {!isUser && (
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold tracking-wide text-[var(--color-accent)]">
                          ZYRQUEN
                        </span>
                      </div>
                    )}
                    {isUser ? (
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                        {msg.content}
                      </p>
                    ) : (
                      <SafeMessageText content={msg.content} />
                    )}
                  </div>

                  {!isUser && (
                    <div className="mt-1.5 flex w-full max-w-[94%] flex-wrap items-center gap-2 px-1 sm:max-w-[85%]">
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

                      {trace && (
                        <button
                          type="button"
                          onClick={() => toggleTrace(msg.id)}
                          aria-expanded={isTraceOpen}
                          className="ml-auto inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
                        >
                          <span>Developer Trace</span>
                          {isTraceOpen ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {!isUser && trace && isTraceOpen && (
                    <div className="mt-1.5 w-full max-w-[94%] space-y-2 sm:max-w-[85%]">
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] text-[var(--color-text-secondary)]">
                        <span>Status: {msg.status}</span>
                        <span>·</span>
                        <span>{(trace.engine_path || []).join(' → ')}</span>
                        <span>·</span>
                        <span className="tabular-nums">{trace.latency_ms ?? 0}ms</span>
                      </div>
                      {trace.task_timings && trace.task_timings.length > 0 && (
                        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-[var(--color-warning)]">
                              เวลาทำงานราย Task ({trace.task_timings.length})
                            </span>
                            {trace.bottleneck_task && (
                              <span className="font-mono text-[11px] text-[var(--color-warning)] tabular-nums">
                                Bottleneck: {trace.bottleneck_task.task} ({trace.bottleneck_task.duration_ms} ms · {trace.bottleneck_task.share_pct}%)
                              </span>
                            )}
                          </div>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {trace.task_timings.map((t, idx) => (
                              <div
                                key={`${t.task}-${idx}`}
                                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1.5 font-mono text-[11px]"
                              >
                                <span className="truncate text-[var(--color-text)]">{t.task}</span>
                                <span
                                  className={`shrink-0 tabular-nums ${
                                    trace.bottleneck_task?.task === t.task
                                      ? 'font-semibold text-[var(--color-warning)]'
                                      : 'text-[var(--color-accent)]'
                                  }`}
                                >
                                  {t.duration_ms} ms
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                            trace.json
                          </span>
                          <CopyButton
                            getText={() => JSON.stringify(redactSensitiveData(trace), null, 2)}
                            ariaLabel="คัดลอก Developer Trace"
                            title="คัดลอก Developer Trace JSON (คัดกรองข้อมูลสำคัญแล้ว)"
                            size="xs"
                          />
                        </div>
                        <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-[var(--color-accent)]">
                          {JSON.stringify(redactSensitiveData(trace), null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex flex-col items-start gap-2" role="status" aria-live="polite">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-xs font-medium text-[var(--color-accent)]">
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
                <span>
                  {activeToolStatus?.label || 'กำลังดำเนินการในพื้นที่ทำงาน...'}
                </span>
              </div>
              {streamingContent && (
                <div className="max-w-[94%] sm:max-w-[85%] rounded-2xl border border-[var(--color-primary)]/40 bg-[var(--color-surface-raised)] px-4 py-3.5 text-[var(--color-text)]">
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
      </div>

      {/* Bottom-Docked Task Composer (Clean, mode-free, model selector moved to Settings) */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 pb-safe sm:px-6 sm:py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {attachment && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-xs text-[var(--color-accent)]">
              <span className="truncate">ไฟล์แนบ: {attachment.name}</span>
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
              accept=".txt,.md,.json,.csv,.py,.ts,.tsx,.js"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="แนบไฟล์ข้อความ"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <Paperclip className="h-4 w-4" />
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
              placeholder="บอกงานที่ต้องการให้ดำเนินการ..."
              aria-label="ช่องพิมพ์คำสั่งงาน"
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3.5 py-2.5 text-[15px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-focus)] focus:outline-none"
            />

            <button
              type="submit"
              disabled={sending || (!input.trim() && !attachment)}
              aria-label="ส่งคำสั่งงาน"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--color-text-muted)]">
            <span>Enter เพื่อดำเนินการ · Shift+Enter ขึ้นบรรทัดใหม่</span>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent)]"
              >
                <Settings className="h-3 w-3" />
                <span>ตั้งค่าโมเดลและพื้นที่ทำงาน</span>
              </button>
            )}
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
