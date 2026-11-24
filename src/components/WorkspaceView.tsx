import React, { useEffect, useRef, useState } from 'react';
import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Cpu,
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
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { detectPendingToolActivity, type ToolId } from '../lib/tools';
import {
  MODEL_VARIANTS,
  type ConversationSmartSummary,
  type ConversationSummary,
  type MessageItem,
  type ModelVariantId,
  type NativeTrace,
  type ReasoningMode,
} from '../types';
import { SafeMessageText } from './SafeMessageText';
import { ZyrquenEmblem } from './ZyrquenEmblem';

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
  onModelVariantChange?: (variant: ModelVariantId) => void;
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
  onModelVariantChange,
  onRetryLast,
}: WorkspaceViewProps) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ReasoningMode>(defaultMode);
  const [prevDefaultMode, setPrevDefaultMode] = useState<ReasoningMode>(defaultMode);
  if (prevDefaultMode !== defaultMode) {
    setPrevDefaultMode(defaultMode);
    setMode(defaultMode);
  }
  const [selectedModelVariant, setSelectedModelVariant] =
    useState<ModelVariantId>(defaultModelVariant);
  const [prevDefaultVariant, setPrevDefaultVariant] =
    useState<ModelVariantId>(defaultModelVariant);
  if (prevDefaultVariant !== defaultModelVariant) {
    setPrevDefaultVariant(defaultModelVariant);
    setSelectedModelVariant(defaultModelVariant);
  }
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
    setActiveToolStatus(detectPendingToolActivity(contentToSend, mode));
    setInput('');
    setAttachment(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    try {
      await onSendMessage(contentToSend, mode, attachmentContent, selectedModelVariant);
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
    <div className="relative flex h-[calc(100dvh-52px)] flex-col bg-[#060A14] md:h-[calc(100dvh-60px)]">
      {/* Compact Workspace Toolbar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800/80 bg-[#090F1E] px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label="เปิดประวัติบทสนทนา"
            className="flex min-h-[44px] items-center gap-2 rounded-xl px-2.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-slate-100 whitespace-nowrap"
          >
            <History className="h-4 w-4 text-cyan-300" />
            <span>ประวัติ</span>
            <span className="text-slate-500 tabular-nums">({conversations.length})</span>
          </button>
          <span className="hidden text-slate-700 sm:inline" aria-hidden="true">
            /
          </span>
          <p className="hidden max-w-[260px] truncate text-xs font-medium text-slate-300 sm:block">
            {activeTitle}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {activeConversationId && messages.length > 0 && (
            <button
              type="button"
              onClick={() => setSummaryOpen((prev) => !prev)}
              aria-expanded={summaryOpen}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800/70 hover:text-cyan-300 whitespace-nowrap"
            >
              <ListChecks className="h-4 w-4 text-cyan-300" />
              <span className="hidden sm:inline">สรุปสำคัญ</span>
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
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-cyan-300 transition-colors hover:bg-slate-800/70 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>เซสชันใหม่</span>
          </button>
        </div>
      </div>

      {/* Collapsible Native Smart Summary Panel (collapsed by default) */}
      {summaryOpen && activeConversationId && messages.length > 0 && (
        <section
          aria-label="สรุปประเด็นสำคัญอัตโนมัติ"
          className="shrink-0 border-b border-slate-800/80 bg-[#0B1222] px-4 py-3 sm:px-6"
        >
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-cyan-300">
                Smart Summary · ประเด็นและผลลัพธ์ยืนยันแล้ว
              </p>
              {smartSummary && (
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {smartSummary.metrics.verified_count} ยืนยัน ·{' '}
                  {smartSummary.metrics.not_learned_count} Not Learned
                </span>
              )}
            </div>
            {summaryLoading ? (
              <p className="mt-2 text-xs text-slate-400">กำลังสรุปจากแกนสมองภายใน...</p>
            ) : smartSummary && smartSummary.bullets.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-200">
                {smartSummary.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                    <div className="min-w-0 flex-1">
                      <SafeMessageText content={bullet} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                ยังไม่มีผลลัพธ์เชิงโครงสร้างในบทสนทนานี้
              </p>
            )}
          </div>
        </section>
      )}

      {/* Scrollable Conversation Area */}
      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {loadingThread ? (
            <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] p-6 text-sm text-slate-400">
              กำลังโหลดประวัติข้อความ...
            </div>
          ) : messages.length === 0 ? (
            <div className="my-6 flex flex-col items-start gap-5 rounded-3xl border border-slate-800/80 bg-[#0E172B] p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <ZyrquenEmblem size={36} />
                <div>
                  <h2 className="text-lg font-bold text-slate-50">เวิร์กสเปซ ZYRQUEN Ω∞</h2>
                  <p className="text-xs text-slate-400">
                    Python 3.11 AST · กราฟความรู้ภายใน · Checkpoint N-Gram
                  </p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-300">
                ทุกคำตอบประมวลผลจากแกนสมองภายในโดยตรง ไม่เชื่อมต่อ LLM ภายนอก คุณสามารถคำนวณนิพจน์ทางคณิตศาสตร์ สอนและถามกราฟความรู้ หรือทดสอบ Checkpoint ที่ฝึกไว้ได้ทันที
              </p>
              <div className="grid w-full gap-2.5 sm:grid-cols-2">
                {[
                  { text: 'คำนวณ (144 / 12) + sqrt(81)', m: 'math' as ReasoningMode },
                  { text: 'สอน: ZYRQUEN -> บังคับใช้ -> Approval Gate', m: 'knowledge' as ReasoningMode },
                  { text: 'ZYRQUEN บังคับใช้อะไร', m: 'knowledge' as ReasoningMode },
                  { text: 'ทดสอบคำถามที่ยังไม่ได้เรียนรู้', m: 'auto' as ReasoningMode },
                ].map((q) => (
                  <button
                    key={q.text}
                    type="button"
                    onClick={async () => {
                      setActiveToolStatus(detectPendingToolActivity(q.text, q.m));
                      try {
                        await onSendMessage(q.text, q.m, undefined, selectedModelVariant);
                      } finally {
                        setActiveToolStatus(null);
                      }
                    }}
                    className="min-h-[48px] rounded-2xl border border-slate-800 bg-[#070C18] px-4 py-2.5 text-left text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/50 hover:text-cyan-200"
                  >
                    {q.text}
                  </button>
                ))}
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
                    className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-3.5 ${
                      isUser
                        ? 'bg-blue-600 text-white'
                        : 'border border-slate-800/90 bg-[#0E172B] text-slate-100'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                        {msg.content}
                      </p>
                    ) : (
                      <SafeMessageText content={msg.content} />
                    )}
                  </div>

                  {!isUser && trace && (
                    <div className="mt-2 w-full max-w-[92%] sm:max-w-[85%]">
                      <button
                        type="button"
                        onClick={() => toggleTrace(msg.id)}
                        className="flex min-h-[36px] items-center gap-2 px-1 text-xs text-slate-400 hover:text-cyan-300"
                      >
                        <span>
                          {msg.status} · {(trace.engine_path || []).join(' → ')} ·{' '}
                          <span className="tabular-nums">{trace.latency_ms ?? 0}ms</span>
                        </span>
                        {isTraceOpen ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {isTraceOpen && (
                        <pre className="mt-1.5 overflow-x-auto rounded-xl border border-slate-800 bg-[#070C18] p-3 font-mono text-[11px] leading-relaxed text-cyan-200/90">
                          {JSON.stringify(trace, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {sending && (
            <div className="flex flex-col items-start gap-2" role="status" aria-live="polite">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-800/90 bg-[#0E172B] px-3.5 py-2.5 text-xs font-medium text-cyan-300">
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
                  {activeToolStatus?.label || 'กำลังประมวลผลผ่านแกนสมอง Python ภายใน...'}
                </span>
              </div>
              {streamingContent && (
                <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl border border-blue-500/30 bg-[#0E172B] px-4 py-3.5 text-slate-100">
                  <SafeMessageText content={streamingContent} />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"
            >
              <span>{error}</span>
              {onRetryLast && (
                <button
                  type="button"
                  onClick={onRetryLast}
                  className="min-h-[36px] rounded-lg bg-rose-500/20 px-3 text-xs font-medium text-rose-100 hover:bg-rose-500/30"
                >
                  ลองใหม่
                </button>
              )}
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>
      </div>

      {/* Bottom-Docked Message Composer */}
      <div className="shrink-0 border-t border-slate-800/90 bg-[#090F1E] px-3 py-2.5 pb-safe sm:px-6 sm:py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-[#060A14] p-1">
              {(
                [
                  { id: 'auto', label: 'อัตโนมัติ' },
                  { id: 'math', label: 'คณิต' },
                  { id: 'knowledge', label: 'ความจำ' },
                  { id: 'model', label: 'โมเดล' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`min-h-[32px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    mode === m.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {attachment && (
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-800 bg-[#0E172B] px-2.5 py-1 text-xs text-cyan-300">
                <span className="max-w-[140px] truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  aria-label="ลบไฟล์แนบ"
                  className="text-slate-400 hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {(speechError || listening) && (
            <div className="flex items-center justify-between gap-2 text-xs">
              {speechError ? (
                <span className="text-rose-300">{speechError}</span>
              ) : (
                <span className="text-cyan-300">
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
                  className="rounded-lg border border-slate-700 bg-[#060A14] px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:border-cyan-400"
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
              accept=".txt,.md,.json,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="แนบไฟล์ข้อความ"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-[#060A14] text-slate-300 transition-colors hover:border-slate-700 hover:text-cyan-300"
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
                  ? 'border-cyan-400 bg-cyan-950/50 text-cyan-300'
                  : 'border-slate-800 bg-[#060A14] text-slate-300 hover:border-slate-700 hover:text-cyan-300'
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
              placeholder="พิมพ์ข้อความถึงแกนสมอง ZYRQUEN..."
              aria-label="ช่องพิมพ์ข้อความ"
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-800 bg-[#060A14] px-3.5 py-2.5 text-[15px] text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />

            <button
              type="submit"
              disabled={sending || (!input.trim() && !attachment)}
              aria-label="ส่งข้อความ"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          {/* Composer Footer: Consistent Model Variant Selector across Mobile & Desktop */}
          <footer
            aria-label="ส่วนท้ายช่องข้อความ"
            className="flex items-center justify-between gap-2 border-t border-slate-800/70 pt-2"
          >
            <div className="relative flex min-w-0 items-center">
              <Cpu
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-blue-400"
                aria-hidden="true"
              />
              <select
                aria-label="เลือกรุ่นโมเดล (Model Variant)"
                value={selectedModelVariant}
                onChange={(e) => {
                  const nextVariant = e.target.value as ModelVariantId;
                  setSelectedModelVariant(nextVariant);
                  onModelVariantChange?.(nextVariant);
                }}
                className="h-9 max-w-[230px] cursor-pointer appearance-none rounded-xl border border-blue-500/35 bg-[#060A14] pl-8 pr-8 font-mono text-xs font-medium text-slate-100 transition-colors hover:border-blue-400/60 hover:bg-[#0E172B] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 sm:max-w-none"
              >
                {MODEL_VARIANTS.map((variant) => (
                  <option
                    key={variant.id}
                    value={variant.id}
                    className="bg-[#0E172B] text-slate-100"
                  >
                    {variant.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-blue-400"
                aria-hidden="true"
              />
            </div>

            <span className="truncate font-mono text-[11px] text-blue-300/80">
              <span className="sm:hidden">{selectedModelVariant}</span>
              <span className="hidden sm:inline">
                {selectedModelVariant} · Enter ส่ง
              </span>
            </span>
          </footer>
        </form>
      </div>

      {/* Adaptive History Sheet (Bottom Sheet on Mobile, Slide-over Drawer on Tablet/Desktop) */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-stretch md:justify-start">
          <div
            className="flex max-h-[82dvh] w-full flex-col rounded-t-3xl border-t border-slate-800 bg-[#0E172B] md:h-full md:max-h-none md:w-80 md:rounded-none md:border-r md:border-t-0"
            role="dialog"
            aria-label="ประวัติบทสนทนา"
          >
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-slate-700 md:hidden" />
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-100">ประวัติบทสนทนา</h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="ปิดประวัติ"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-100"
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
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-medium text-white hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                <span>เริ่มบทสนทนาใหม่</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-6 divide-y divide-slate-800/70">
              {conversations.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">ยังไม่มีบทสนทนาที่บันทึกไว้</p>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`flex items-center justify-between gap-2 py-2 px-2 rounded-xl ${
                      conv.id === activeConversationId ? 'bg-[#131F38]' : ''
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
                      <p className="truncate text-sm font-medium text-slate-100">{conv.title}</p>
                      <p className="text-xs text-slate-400 tabular-nums">
                        {conv.mode} · {conv.message_count} ข้อความ
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteConversation(conv.id)}
                      aria-label={`ลบ ${conv.title}`}
                      className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-950/40 hover:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="ปิดแถบประวัติ"
            className="hidden flex-1 md:block"
            onClick={() => setHistoryOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
