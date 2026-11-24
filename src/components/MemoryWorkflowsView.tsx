import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Play,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import type {
  KnowledgeTriple,
  User,
  WorkflowGroup,
  WorkflowRun,
  WorkflowStageResult,
} from '../types';

interface MemoryWorkflowsViewProps {
  token: string;
  user: User;
}

function renderStatusLabel(status: string) {
  switch (status) {
    case 'COMPLETED':
    case 'PASS':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-300">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>{status}</span>
        </span>
      );
    case 'PENDING_APPROVAL':
    case 'WARN':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300">
          <Clock className="h-3.5 w-3.5" />
          <span>{status}</span>
        </span>
      );
    case 'FAILED':
    case 'REJECTED':
    case 'BLOCKED':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-300">
          <XCircle className="h-3.5 w-3.5" />
          <span>{status}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <span>{status}</span>
        </span>
      );
  }
}

export function MemoryWorkflowsView({ token, user }: MemoryWorkflowsViewProps) {
  const [tab, setTab] = useState<'knowledge' | 'workflows'>('knowledge');
  const [triples, setTriples] = useState<KnowledgeTriple[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [relation, setRelation] = useState('');
  const [objectVal, setObjectVal] = useState('');
  const [contradictionWarning, setContradictionWarning] = useState<string | null>(null);

  const [groups, setGroups] = useState<WorkflowGroup[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [runningGroupId, setRunningGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tripleFuse = useMemo(
    () =>
      new Fuse(triples, {
        keys: ['subject', 'relation', 'object', 'source'],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [triples]
  );

  const groupFuse = useMemo(
    () =>
      new Fuse(groups, {
        keys: ['id', 'name', 'description', 'stages'],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [groups]
  );

  const runFuse = useMemo(
    () =>
      new Fuse(runs, {
        keys: ['group_id', 'status', 'summary'],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [runs]
  );

  const trimmedQuery = searchQuery.trim();

  const fuzzyTriples = useMemo(
    () => (trimmedQuery ? tripleFuse.search(trimmedQuery).map((r) => r.item) : triples),
    [trimmedQuery, tripleFuse, triples]
  );

  const fuzzyGroups = useMemo(
    () => (trimmedQuery ? groupFuse.search(trimmedQuery).map((r) => r.item) : groups),
    [trimmedQuery, groupFuse, groups]
  );

  const fuzzyRuns = useMemo(
    () => (trimmedQuery ? runFuse.search(trimmedQuery).map((r) => r.item) : runs),
    [trimmedQuery, runFuse, runs]
  );

  const loadData = useCallback(
    async () => {
      await Promise.resolve();
      setLoading(true);
      setError(null);
      try {
        const [kRes, wRes] = await Promise.all([
          apiRequest<{ triples: KnowledgeTriple[] }>('/api/knowledge', { token }),
          apiRequest<{ groups: WorkflowGroup[]; runs: WorkflowRun[] }>('/api/workflows', {
            token,
          }),
        ]);
        setTriples(kRes.triples);
        setGroups(wRes.groups);
        setRuns(wRes.runs);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'ไม่สามารถโหลดข้อมูลความจำและเวิร์กโฟลว์ได้');
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function handleAddTriple(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setContradictionWarning(null);
    try {
      const res = await apiRequest<{
        triple: KnowledgeTriple;
        contradictions: string[];
      }>('/api/knowledge', {
        method: 'POST',
        token,
        body: { subject, relation, object: objectVal },
      });
      setTriples((prev) => [res.triple, ...prev]);
      setSubject('');
      setRelation('');
      setObjectVal('');
      if (res.contradictions?.length) {
        setContradictionWarning(
          `ตรวจพบข้อมูลขัดแย้งกับค่าเดิม: ${res.contradictions.join(', ')}`
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกความสัมพันธ์ไม่สำเร็จ');
    }
  }

  async function handleDeleteTriple(id: string) {
    try {
      await apiRequest(`/api/knowledge/${id}`, { method: 'DELETE', token });
      setTriples((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบความสัมพันธ์ไม่สำเร็จ');
    }
  }

  async function handleRunWorkflow(groupId: string) {
    setRunningGroupId(groupId);
    setError(null);
    try {
      const res = await apiRequest<{ run: WorkflowRun }>(`/api/workflows/${groupId}/run`, {
        method: 'POST',
        token,
        body: {},
      });
      setRuns((prev) => [res.run, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เรียกทำงานเวิร์กโฟลว์ไม่สำเร็จ');
    } finally {
      setRunningGroupId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-50">
            ความจำและระบบเวิร์กโฟลว์ภายใน
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            จัดการกราฟความรู้ถาวรและสั่งงานเวิร์กโฟลว์กลางทั้ง 8 กลุ่มงานของ ZYRQUEN
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-[#0E172B] p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => setTab('knowledge')}
            className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === 'knowledge'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <BrainCircuit className="h-3.5 w-3.5" />
            <span>กราฟความรู้ ({fuzzyTriples.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('workflows')}
            className={`flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 text-xs font-medium transition-colors whitespace-nowrap ${
              tab === 'workflows'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Workflow className="h-3.5 w-3.5" />
            <span>ระบบเวิร์กโฟลว์ ({fuzzyGroups.length})</span>
          </button>
        </div>
      </div>

      {/* Unified Global Fuzzy Search Bar (queries Knowledge Fragments & Workflow Definitions) */}
      <div className="mb-6 relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ค้นหาแบบคลุมเครือ (Fuzzy Search) ทั้งกราฟความรู้และนิยามเวิร์กโฟลว์..."
          aria-label="ค้นหากราฟความรู้และเวิร์กโฟลว์"
          className="h-11 w-full rounded-xl border border-slate-800 bg-[#0E172B] pl-10 pr-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="ล้างคำค้นหา"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      {trimmedQuery ? (
        <div className="space-y-6" aria-label="ผลลัพธ์การค้นหาทั้งหมด">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-cyan-300 tabular-nums">
              กราฟความรู้ที่ตรงกัน ({fuzzyTriples.length})
            </h3>
            <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] divide-y divide-slate-800/80">
              {fuzzyTriples.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">
                  ไม่พบความจำในกราฟความรู้ที่ตรงกับ &ldquo;{trimmedQuery}&rdquo;
                </p>
              ) : (
                fuzzyTriples.map((t) => (
                  <div
                    key={t.id}
                    className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-100">
                        <span>{t.subject}</span>
                        <span className="mx-2 text-cyan-400">→ {t.relation} →</span>
                        <span>{t.object}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 tabular-nums">{t.source}</p>
                    </div>
                    {(user.role === 'admin' || t.created_by === user.id) && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteTriple(t.id)}
                        aria-label={`ลบความสัมพันธ์ ${t.subject}`}
                        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-950/40 hover:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-cyan-300 tabular-nums">
              นิยามเวิร์กโฟลว์ที่ตรงกัน ({fuzzyGroups.length})
            </h3>
            {fuzzyGroups.length === 0 ? (
              <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] p-4 text-sm text-slate-400">
                ไม่พบนิยามเวิร์กโฟลว์ที่ตรงกับ &ldquo;{trimmedQuery}&rdquo;
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {fuzzyGroups.map((grp) => (
                  <div
                    key={grp.id}
                    className="flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0E172B] p-4"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-slate-100">{grp.name}</h4>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                        {grp.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={runningGroupId === grp.id}
                      onClick={() => void handleRunWorkflow(grp.id)}
                      className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#070C18] text-xs font-medium text-cyan-300 transition-colors hover:border-cyan-500/60 hover:bg-[#131F38] disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{runningGroupId === grp.id ? 'กำลังทำงาน...' : 'เริ่มรันเวิร์กโฟลว์'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {fuzzyRuns.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-semibold text-cyan-300 tabular-nums">
                ประวัติการรันที่ตรงกัน ({fuzzyRuns.length})
              </h3>
              <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] divide-y divide-slate-800/80">
                {fuzzyRuns.map((run) => (
                  <div key={run.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-100">{run.group_id}</span>
                      {renderStatusLabel(run.status)}
                    </div>
                    <p className="mt-1 text-xs text-slate-300">{run.summary}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : tab === 'knowledge' ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 lg:col-span-5">
            <h3 className="text-base font-semibold text-slate-100">บันทึกความสัมพันธ์ใหม่</h3>
            <p className="mt-1 text-xs text-slate-400">
              เพิ่มความรู้ลงในกราฟ SQLite ภายในพร้อมตรวจสอบข้อขัดแย้งกับความจำเดิมอัตโนมัติ
            </p>

            <form onSubmit={handleAddTriple} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="triple-subject" className="mb-1 block text-xs text-slate-300">
                  ประธาน (Subject)
                </label>
                <input
                  id="triple-subject"
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="ZYRQUEN"
                  className="h-11 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="triple-relation" className="mb-1 block text-xs text-slate-300">
                  ความสัมพันธ์ (Relation)
                </label>
                <input
                  id="triple-relation"
                  type="text"
                  required
                  value={relation}
                  onChange={(e) => setRelation(e.target.value)}
                  placeholder="บังคับใช้"
                  className="h-11 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="triple-object" className="mb-1 block text-xs text-slate-300">
                  กรรม (Object)
                </label>
                <input
                  id="triple-object"
                  type="text"
                  required
                  value={objectVal}
                  onChange={(e) => setObjectVal(e.target.value)}
                  placeholder="Approval Gate"
                  className="h-11 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </div>

              {contradictionWarning && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{contradictionWarning}</span>
                </div>
              )}

              <button
                type="submit"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-medium text-white hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                <span>เพิ่มความจำ</span>
              </button>
            </form>
          </section>

          <section className="lg:col-span-7">
            <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] divide-y divide-slate-800/80">
              {loading ? (
                <div className="p-6 text-sm text-slate-400">กำลังโหลดกราฟความรู้...</div>
              ) : fuzzyTriples.length === 0 ? (
                <div className="p-6 text-sm text-slate-400">
                  {searchQuery
                    ? `ไม่พบความสัมพันธ์ที่ตรงกับ "${searchQuery}"`
                    : 'ยังไม่มีข้อมูลในกราฟความรู้ คุณสามารถสอนในเวิร์กสเปซหรือเพิ่มจากแบบฟอร์มด้านซ้าย'}
                </div>
              ) : (
                fuzzyTriples.map((t) => (
                  <div
                    key={t.id}
                    className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-100">
                        <span>{t.subject}</span>
                        <span className="mx-2 text-cyan-400">→ {t.relation} →</span>
                        <span>{t.object}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                        {t.source} · {new Date(t.created_at).toLocaleDateString('th-TH')}
                      </p>
                    </div>
                    {(user.role === 'admin' || t.created_by === user.id) && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteTriple(t.id)}
                        aria-label={`ลบความสัมพันธ์ ${t.subject}`}
                        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-950/40 hover:text-rose-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Filtered Workflow Groups */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fuzzyGroups.map((grp) => (
              <div
                key={grp.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-[#0E172B] p-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-100">{grp.name}</h3>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {grp.description}
                  </p>
                  <p className="mt-3 text-[11px] text-slate-500">
                    {grp.requires_approval ? 'ต้องผ่าน Approval Gate' : 'ทำงานอัตโนมัติได้ทันที'} ·{' '}
                    <span className="tabular-nums">{grp.stages.length} ขั้นตอน</span>
                  </p>
                </div>

                <button
                  type="button"
                  disabled={runningGroupId === grp.id}
                  onClick={() => void handleRunWorkflow(grp.id)}
                  className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#070C18] text-xs font-medium text-cyan-300 transition-colors hover:border-cyan-500/60 hover:bg-[#131F38] disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{runningGroupId === grp.id ? 'กำลังทำงาน...' : 'เริ่มรันเวิร์กโฟลว์'}</span>
                </button>
              </div>
            ))}
          </section>

          {/* Recent Workflow Executions */}
          <section>
            <h3 className="mb-3 text-base font-semibold text-slate-100">
              ประวัติการรันเวิร์กโฟลว์ล่าสุด
            </h3>
            <div className="rounded-2xl border border-slate-800/80 bg-[#0E172B] divide-y divide-slate-800/80">
              {fuzzyRuns.length === 0 ? (
                <div className="p-6 text-sm text-slate-400">
                  {searchQuery
                    ? `ไม่พบประวัติเวิร์กโฟลว์ที่ตรงกับ "${searchQuery}"`
                    : 'ยังไม่มีการรันเวิร์กโฟลว์ เลือกกลุ่มงานด้านบนเพื่อตรวจสอบสถานะจริงของระบบ'}
                </div>
              ) : (
                fuzzyRuns.map((run) => {
                  let stages: WorkflowStageResult[];
                  try {
                    stages = JSON.parse(run.stages_json) as WorkflowStageResult[];
                  } catch {
                    stages = [];
                  }
                  return (
                    <div key={run.id} className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-slate-100">
                            {run.group_id}
                          </span>
                          {renderStatusLabel(run.status)}
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums">
                          {new Date(run.created_at).toLocaleString('th-TH')}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-300">{run.summary}</p>
                      {stages.length > 0 && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {stages.map((st) => (
                            <div
                              key={st.stage}
                              className="rounded-xl border border-slate-800/80 bg-[#070C18] px-3 py-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] text-slate-300">
                                  {st.stage}
                                </span>
                                {renderStatusLabel(st.status)}
                              </div>
                              {st.detail && (
                                <p className="mt-1 text-[11px] text-slate-400">{st.detail}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
