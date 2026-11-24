import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  KeyRound,
  LogOut,
  Play,
  Shield,
  ShieldCheck,
  Terminal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import { runNativeCapabilityBenchmark } from '../lib/benchmark';
import { MODEL_VARIANTS } from '../types';
import { ToolRegistry } from './ToolRegistry';
import type {
  AdminOverview,
  DeveloperOverview,
  ModelVariantId,
  NativeBenchmarkEvaluation,
  ReasoningMode,
  SettingsTab,
  ToolsOverview,
  User,
} from '../types';

interface SettingsViewProps {
  token: string;
  user: User;
  activeTab: SettingsTab;
  autoExpandTrace: boolean;
  defaultMode: ReasoningMode;
  onChangeTab: (tab: SettingsTab) => void;
  onUpdatePreferences: (prefs: { autoExpandTrace?: boolean; defaultMode?: ReasoningMode }) => void;
  onLogout: () => void;
}

export function SettingsView({
  token,
  user,
  activeTab,
  autoExpandTrace,
  defaultMode,
  onChangeTab,
  onUpdatePreferences,
  onLogout,
}: SettingsViewProps) {
  const [devData, setDevData] = useState<DeveloperOverview | null>(null);
  const [toolsData, setToolsData] = useState<ToolsOverview | null>(null);
  const [adminData, setAdminData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyName, setKeyName] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const [dsName, setDsName] = useState('');
  const [dsContent, setDsContent] = useState('');
  const [dsMessage, setDsMessage] = useState<string | null>(null);
  const [runningEval, setRunningEval] = useState(false);
  const [requestingTrainId, setRequestingTrainId] = useState<string | null>(null);
  const [benchmarkModel, setBenchmarkModel] = useState<ModelVariantId>('zyrquen-omega-v1');
  const [runningBenchmark, setRunningBenchmark] = useState(false);
  const [benchmarkEval, setBenchmarkEval] = useState<NativeBenchmarkEvaluation | null>(null);
  const [curatingCorpus, setCuratingCorpus] = useState(false);
  const [runningExperiment, setRunningExperiment] = useState(false);
  const [experimentMsg, setExperimentMsg] = useState<string | null>(null);

  const loadDeveloper = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, toolsRes] = await Promise.all([
        apiRequest<DeveloperOverview>('/api/developer/overview', { token }),
        apiRequest<ToolsOverview>('/api/developer/tools', { token }).catch(() => null),
      ]);
      setDevData(res);
      if (toolsRes) setToolsData(toolsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ไม่สามารถโหลดเครื่องมือนักพัฒนาได้');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadAdmin = useCallback(async () => {
    if (user.role !== 'admin') return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AdminOverview>('/api/admin/overview', { token });
      setAdminData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ไม่สามารถโหลดส่วนผู้ดูแลระบบได้');
    } finally {
      setLoading(false);
    }
  }, [token, user.role]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      if (activeTab === 'developer') {
        void loadDeveloper();
      } else if (activeTab === 'admin' && user.role === 'admin') {
        void loadAdmin();
      }
    });
    return () => {
      active = false;
    };
  }, [activeTab, loadAdmin, loadDeveloper, user.role]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ plaintextKey: string }>('/api/developer/keys', {
        method: 'POST',
        token,
        body: { name: keyName, scopes: ['infer:read', 'knowledge:write'] },
      });
      setCreatedSecret(res.plaintextKey);
      setKeyName('');
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'สร้าง API Key ไม่สำเร็จ');
    }
  }

  async function handleRevokeKey(id: string) {
    try {
      await apiRequest(`/api/developer/keys/${id}`, { method: 'DELETE', token });
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เพิกถอน API Key ไม่สำเร็จ');
    }
  }

  async function handleIngestDataset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDsMessage(null);
    try {
      const res = await apiRequest<{
        dataset: { name: string; train_count: number; val_count: number; test_count: number; manifest_hash: string };
        deduplicated_removed: number;
      }>('/api/developer/datasets', {
        method: 'POST',
        token,
        body: { name: dsName, content: dsContent },
      });
      setDsMessage(
        `นำเข้า "${res.dataset.name}" แล้ว: Train ${res.dataset.train_count} / Val ${res.dataset.val_count} / Test ${res.dataset.test_count} (คัดกรองซ้ำ ${res.deduplicated_removed} รายการ)`
      );
      setDsName('');
      setDsContent('');
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'นำเข้าชุดข้อมูลไม่สำเร็จ');
    }
  }

  async function handleRunEvaluation() {
    setRunningEval(true);
    setError(null);
    try {
      await apiRequest('/api/developer/evaluate', {
        method: 'POST',
        token,
        body: { suiteName: 'ZYRQUEN Scientific Benchmark v1' },
      });
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'รันการประเมินผลไม่สำเร็จ');
    } finally {
      setRunningEval(false);
    }
  }

  async function handleRunCapabilityBenchmark() {
    setRunningBenchmark(true);
    setError(null);
    try {
      const evaluation = await runNativeCapabilityBenchmark(token, {
        modelVersion: benchmarkModel,
        logToConsole: true,
      });
      setBenchmarkEval(evaluation);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'รัน Capability Benchmark จริงไม่สำเร็จ'
      );
    } finally {
      setRunningBenchmark(false);
    }
  }

  async function handleRequestTrainingGate(datasetId: string, datasetName: string) {
    setRequestingTrainId(datasetId);
    setError(null);
    setDsMessage(null);
    try {
      const res = await apiRequest<{
        run: { status: string; summary: string };
      }>('/api/workflows/native_training/run', {
        method: 'POST',
        token,
        body: { datasetId },
      });
      setDsMessage(
        res.run.status === 'PENDING_APPROVAL'
          ? `ส่งคำขอฝึกชุดข้อมูล "${datasetName}" เข้า Approval Gate แล้ว (รอผู้ดูแลระบบอนุมัติ)`
          : res.run.summary
      );
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ส่งคำขอฝึกโมเดลไม่สำเร็จ');
    } finally {
      setRequestingTrainId(null);
    }
  }

  async function handleApprovalDecision(runId: string, decision: 'approve' | 'reject') {
    setError(null);
    try {
      await apiRequest(`/api/workflows/runs/${runId}/decide`, {
        method: 'POST',
        token,
        body: { decision },
      });
      await loadAdmin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดำเนินการ Approval Gate ไม่สำเร็จ');
    }
  }

  async function handleCurateCorpus() {
    setCuratingCorpus(true);
    setError(null);
    setExperimentMsg(null);
    try {
      const res = await apiRequest<{
        dataset: { name: string; total_records: number };
      }>('/api/developer/curate-corpus', {
        method: 'POST',
        token,
        body: { name: 'verified-knowledge-corpus' },
      });
      setExperimentMsg(
        `คัดกรองชุดข้อมูล "${res.dataset.name}" จากความจำที่ยืนยันแล้ว (${res.dataset.total_records} รายการ)`
      );
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'คัดกรองชุดข้อมูลจากความจำไม่สำเร็จ');
    } finally {
      setCuratingCorpus(false);
    }
  }

  async function handleRunNeuralExperiment() {
    setRunningExperiment(true);
    setError(null);
    setExperimentMsg(null);
    try {
      const cleanDs = (devData?.datasets || []).find((d) => !d.leakage_detected);
      const res = await apiRequest<{
        improved: boolean;
        experiment: { approval_status: string };
      }>('/api/developer/experiments', {
        method: 'POST',
        token,
        body: { datasetId: cleanDs?.id || null, epochs: 8 },
      });
      setExperimentMsg(
        res.improved
          ? 'การทดลอง Neural Transformer ลด Val Loss สำเร็จ — ส่งเข้าคิวอนุมัติผู้ดูแลระบบแล้ว'
          : `การทดลองเสร็จสิ้น (สถานะ: ${res.experiment.approval_status})`
      );
      await loadDeveloper();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'รันการทดลอง Neural Transformer ไม่สำเร็จ');
    } finally {
      setRunningExperiment(false);
    }
  }

  async function handleExperimentDecision(expId: string, decision: 'approve' | 'reject') {
    setError(null);
    try {
      await apiRequest(`/api/admin/experiments/${expId}/decide`, {
        method: 'POST',
        token,
        body: { decision },
      });
      await loadAdmin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ดำเนินการอนุมัติการทดลองไม่สำเร็จ');
    }
  }

  async function handleRoleChange(targetUserId: string, role: 'admin' | 'user') {
    setError(null);
    try {
      await apiRequest(`/api/admin/users/${targetUserId}/role`, {
        method: 'PATCH',
        token,
        body: { role },
      });
      await loadAdmin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เปลี่ยนสิทธิ์ผู้ใช้ไม่สำเร็จ');
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-50">ตั้งค่า</h2>
          <p className="mt-1 text-sm text-slate-400">
            แยกการตั้งค่าบัญชีผู้ใช้ออกจากเครื่องมือนักพัฒนาและส่วนผู้ดูแลระบบอย่างชัดเจน
          </p>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-[#0E172B] p-1">
          <button
            type="button"
            onClick={() => onChangeTab('account')}
            className={`flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'account'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <UserIcon className="h-3.5 w-3.5" />
            <span>บัญชีผู้ใช้</span>
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('developer')}
            className={`flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'developer'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>นักพัฒนา</span>
          </button>

          {user.role === 'admin' && (
            <button
              type="button"
              onClick={() => onChangeTab('admin')}
              className={`flex min-h-[40px] items-center gap-2 rounded-lg px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === 'admin'
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              <span>ผู้ดูแลระบบ</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      {/* TAB 1: บัญชีผู้ใช้ */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
            <h3 className="text-base font-semibold text-slate-100">โปรไฟล์และเซสชัน</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-400">ชื่อที่แสดง</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{user.display_name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">อีเมล</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{user.email}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">สิทธิ์การเข้าถึง</p>
                <p className="mt-1 text-sm font-medium text-cyan-300">
                  {user.role === 'admin' ? 'ผู้ดูแลระบบ (admin)' : 'ผู้ใช้งานทั่วไป (user)'}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
            <h3 className="text-base font-semibold text-slate-100">การตั้งค่าเวิร์กสเปซ</h3>
            <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">โหมดการประมวลผลเริ่มต้น</p>
                  <p className="text-xs text-slate-400">
                    กำหนดแกนประมวลผลหลักเมื่อเปิดเซสชันใหม่ในเวิร์กสเปซ
                  </p>
                </div>
                <select
                  value={defaultMode}
                  onChange={(e) =>
                    onUpdatePreferences({ defaultMode: e.target.value as ReasoningMode })
                  }
                  className="h-11 rounded-xl border border-slate-800 bg-[#070C18] px-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="auto">อัตโนมัติภายใน (Auto)</option>
                  <option value="math">คณิตศาสตร์ AST</option>
                  <option value="knowledge">กราฟความรู้</option>
                  <option value="plan">วางแผนงาน DAG</option>
                  <option value="model">Checkpoint N-Gram</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-slate-800/80 pt-4">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    แสดงร่องรอยการประมวลผลอัตโนมัติ
                  </p>
                  <p className="text-xs text-slate-400">
                    กางลำดับขั้น AST, แหล่งอ้างอิงความรู้ และเวลาทำงานใต้คำตอบโดยอัตโนมัติ
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoExpandTrace}
                  onClick={() => onUpdatePreferences({ autoExpandTrace: !autoExpandTrace })}
                  className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors ${
                    autoExpandTrace ? 'bg-blue-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="h-6 w-6 rounded-full bg-white" />
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-100">ออกจากระบบ</h3>
                <p className="text-xs text-slate-400">
                  ยกเลิกโทเคนเซสชันบนเซิร์ฟเวอร์และล้างหน่วยความจำทันที
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/30 px-5 text-sm font-medium text-rose-200 hover:bg-rose-950/60"
              >
                <LogOut className="h-4 w-4" />
                <span>ออกจากระบบ</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: เครื่องมือนักพัฒนา */}
      {activeTab === 'developer' && (
        <div className="space-y-6">
          {loading && !devData ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0E172B] p-6 text-sm text-slate-400">
              กำลังโหลดข้อมูลนักพัฒนา...
            </div>
          ) : (
            <>
              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-800/90 bg-[#0E172B] p-4">
                  <p className="text-xs text-slate-400">จำนวนคำขอ API ทั้งหมด</p>
                  <p className="mt-1 text-2xl font-bold text-slate-50 tabular-nums">
                    {devData?.usage.total_requests ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/90 bg-[#0E172B] p-4">
                  <p className="text-xs text-slate-400">โควตารายวัน</p>
                  <p className="mt-1 text-2xl font-bold text-cyan-300 tabular-nums">
                    {devData?.usage.daily_quota ?? 1000}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800/90 bg-[#0E172B] p-4">
                  <p className="text-xs text-slate-400">ความหน่วง API เฉลี่ย</p>
                  <p className="mt-1 text-2xl font-bold text-slate-50 tabular-nums">
                    {devData?.usage.avg_latency_ms ?? 0} ms
                  </p>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-cyan-300" />
                  <h3 className="text-base font-semibold text-slate-100">จัดการ API Keys</h3>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  คีย์ถูกแฮชด้วย SHA-256 บนเซิร์ฟเวอร์ และแสดงคีย์เต็มเพียงครั้งเดียวตอนสร้าง
                </p>

                <form onSubmit={handleCreateKey} className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="ชื่อคีย์ (เช่น CLI วิจัย)"
                    className="h-11 flex-1 rounded-xl border border-slate-800 bg-[#070C18] px-3.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500 whitespace-nowrap"
                  >
                    สร้าง API Key
                  </button>
                </form>

                {createdSecret && (
                  <div className="mt-4 rounded-xl border border-cyan-500/40 bg-[#070C18] p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-xs text-cyan-300 break-all">{createdSecret}</p>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(createdSecret);
                          setCopiedSecret(true);
                          setTimeout(() => setCopiedSecret(false), 2000);
                        }}
                        className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-xs text-slate-200 hover:bg-slate-700"
                      >
                        {copiedSecret ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{copiedSecret ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 divide-y divide-slate-800/80">
                  {(devData?.keys || []).length === 0 ? (
                    <p className="py-3 text-sm text-slate-400">ยังไม่มี API Key ที่สร้างไว้</p>
                  ) : (
                    devData!.keys.map((k) => (
                      <div
                        key={k.id}
                        className="flex min-h-[56px] items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-100">{k.name}</p>
                          <p className="font-mono text-xs text-slate-400 tabular-nums">
                            {k.key_prefix}… · โควตา {k.quota_daily}/วัน ·{' '}
                            {k.revoked ? 'เพิกถอนแล้ว' : 'ใช้งานได้'}
                          </p>
                        </div>
                        {!k.revoked && (
                          <button
                            type="button"
                            onClick={() => void handleRevokeKey(k.id)}
                            aria-label={`เพิกถอน ${k.name}`}
                            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-xs text-rose-300 hover:bg-rose-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>เพิกถอน</span>
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-cyan-300" />
                    <h3 className="text-base font-semibold text-slate-100">
                      นำเข้าชุดข้อมูล (Train/Val/Test)
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    คัดกรองข้อมูลซ้ำ ตรวจ Data Leakage และสร้างแฮช SHA-256 (อย่างน้อย 5 บรรทัด)
                  </p>
                  <form onSubmit={handleIngestDataset} className="mt-4 space-y-3">
                    <input
                      type="text"
                      required
                      value={dsName}
                      onChange={(e) => setDsName(e.target.value)}
                      placeholder="ชื่อชุดข้อมูล (เช่น zyrquen-thai-v1)"
                      className="h-11 w-full rounded-xl border border-slate-800 bg-[#070C18] px-3 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                    />
                    <textarea
                      rows={4}
                      required
                      value={dsContent}
                      onChange={(e) => setDsContent(e.target.value)}
                      placeholder="วางประโยคสำหรับฝึกบรรทัดละ 1 รายการ (อย่างน้อย 5 บรรทัดที่ไม่ซ้ำกัน)..."
                      className="w-full resize-none rounded-xl border border-slate-800 bg-[#070C18] p-3 font-mono text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                    />
                    {dsMessage && <p className="text-xs text-cyan-300">{dsMessage}</p>}
                    <button
                      type="submit"
                      className="h-11 w-full rounded-xl bg-blue-600 text-sm font-medium text-white hover:bg-blue-500"
                    >
                      นำเข้าและแบ่งชุดข้อมูล
                    </button>
                  </form>

                  {(devData?.datasets || []).length > 0 && (
                    <div className="mt-5 border-t border-slate-800/80 pt-4">
                      <p className="text-xs font-medium text-slate-300">
                        ชุดข้อมูลที่ลงทะเบียน ({devData!.datasets.length} ชุด)
                      </p>
                      <div className="mt-2 divide-y divide-slate-800/70">
                        {devData!.datasets.map((ds) => (
                          <div
                            key={ds.id}
                            className="flex items-center justify-between gap-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-slate-100">
                                {ds.name}
                              </p>
                              <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                                T:{ds.train_count}/V:{ds.val_count}/T:{ds.test_count} ·{' '}
                                {ds.leakage_detected ? 'พบ Leakage' : 'Leakage ผ่าน'} ·{' '}
                                {ds.manifest_hash.slice(0, 8)}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={Boolean(ds.leakage_detected) || requestingTrainId === ds.id}
                              onClick={() => void handleRequestTrainingGate(ds.id, ds.name)}
                              className="min-h-[36px] shrink-0 rounded-lg border border-slate-700 bg-[#070C18] px-3 text-xs font-medium text-cyan-300 hover:border-cyan-500/60 disabled:opacity-40 whitespace-nowrap"
                            >
                              {requestingTrainId === ds.id ? 'กำลังส่ง...' : 'ส่งคำขอฝึก (Gate)'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-slate-100">
                      Checkpoint โมเดลแบบไม่เขียนทับ
                    </h3>
                    <button
                      type="button"
                      disabled={runningEval}
                      onClick={() => void handleRunEvaluation()}
                      className="min-h-[36px] rounded-lg border border-slate-700 bg-[#070C18] px-3 text-xs font-medium text-cyan-300 transition-colors hover:border-cyan-500/60 disabled:opacity-50 whitespace-nowrap"
                    >
                      {runningEval ? 'กำลังประเมิน...' : 'ประเมินผลเทียบ Baseline'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    สร้างหลังผ่าน Approval Gate ในหน้า ความจำ → ระบบเวิร์กโฟลว์ → ฝึกโมเดลภายใน
                  </p>

                  {devData?.evaluations?.[0] && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-[#070C18] px-3 py-2.5 text-xs text-slate-300 tabular-nums">
                      <span className="font-semibold text-cyan-300">
                        ผลประเมินล่าสุด ({devData.evaluations[0].overall_status})
                      </span>
                      {' · '}คณิต {Math.round(devData.evaluations[0].math_score * 100)}%
                      {' · '}ความจำ {Math.round(devData.evaluations[0].knowledge_score * 100)}%
                      {' · '}แผน DAG {Math.round(devData.evaluations[0].planning_score * 100)}%
                      {devData.evaluations[0].test_accuracy !== null && (
                        <span>
                          {' · '}Test {(devData.evaluations[0].test_accuracy * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-4 divide-y divide-slate-800/80">
                    {(devData?.checkpoints || []).length === 0 ? (
                      <p className="py-4 text-sm text-slate-400">
                        ยังไม่มี Checkpoint ที่ฝึกไว้
                      </p>
                    ) : (
                      devData!.checkpoints.map((ck) => (
                        <div key={ck.id} className="py-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-100">
                              Checkpoint v{ck.version}
                            </span>
                            <span className="text-xs font-medium text-cyan-300">
                              {ck.eval_status}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
                            vocab {ck.vocab_size} · train_loss {ck.train_loss} · val_loss{' '}
                            {ck.val_loss} · ppl {ck.perplexity}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>

              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-cyan-300" />
                      <h3 className="text-base font-semibold text-slate-100">
                        Capability Benchmark (Zero-Mock Native Probe)
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      ทดสอบ Python Native AI Core จริงบนฐานข้อมูลแยกชั่วคราว ตรวจ Source Verification และ Abstention Accuracy พร้อมรายงานผลเข้า DevTools Console
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="เลือกรุ่นโมเดลสำหรับ Benchmark"
                      value={benchmarkModel}
                      onChange={(e) => setBenchmarkModel(e.target.value as ModelVariantId)}
                      className="h-10 rounded-xl border border-slate-700 bg-[#070C18] px-3 text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                    >
                      {MODEL_VARIANTS.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.shortLabel}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={runningBenchmark}
                      onClick={() => void handleRunCapabilityBenchmark()}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>{runningBenchmark ? 'กำลังรัน Benchmark...' : 'รัน Benchmark จริง'}</span>
                    </button>
                  </div>
                </div>

                {!benchmarkEval ? (
                  <p className="mt-4 rounded-xl border border-slate-800/80 bg-[#070C18] px-4 py-3 text-xs text-slate-400">
                    ยังไม่มีผลทดสอบในเซสชันนี้ — กด &ldquo;รัน Benchmark จริง&rdquo; เพื่อวัดความสามารถจริงโดยไม่จำลองคะแนน
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#070C18] px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2 text-slate-200 tabular-nums">
                        <span className="font-semibold text-cyan-300">
                          {benchmarkEval.report.benchmark_version}
                        </span>
                        <span>·</span>
                        <span>
                          คะแนนรวม {benchmarkEval.report.summary.passed}/{benchmarkEval.report.summary.total_cases} (
                          {(benchmarkEval.report.summary.overall_score * 100).toFixed(1)}%)
                        </span>
                        {benchmarkEval.report.summary.failed > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-semibold text-amber-300">
                              {benchmarkEval.report.summary.failed} FAILED
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span className="font-mono text-[11px] text-slate-400">
                          Python {benchmarkEval.report.environment.python_version} · {benchmarkEval.report.environment.model_version}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-1 text-[11px] font-medium text-cyan-300">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Zero External LLMs</span>
                      </span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-[#070C18] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-200">
                            Source Verification (Anti-Fabrication)
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              benchmarkEval.sourceVerification.status === 'VERIFIED'
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            }`}
                          >
                            {benchmarkEval.sourceVerification.status === 'VERIFIED' ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {benchmarkEval.sourceVerification.status} ({benchmarkEval.sourceVerification.passed}/
                              {benchmarkEval.sourceVerification.total})
                            </span>
                          </span>
                        </div>
                        <ul className="mt-3 space-y-1.5 text-[11px] text-slate-300">
                          <li className="flex items-center justify-between">
                            <span>AFB-01 คัดกรองแหล่งปลอม/LLM ภายนอก</span>
                            <span className={benchmarkEval.sourceVerification.checks.fabricatedSourceRejected ? 'text-emerald-300' : 'text-rose-300'}>
                              {benchmarkEval.sourceVerification.checks.fabricatedSourceRejected ? 'PASS' : 'FAIL'}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>AFB-02 บล็อก URL ไม่ปลอดภัย / นอก Allowlist</span>
                            <span className={benchmarkEval.sourceVerification.checks.invalidUrlRejected ? 'text-emerald-300' : 'text-rose-300'}>
                              {benchmarkEval.sourceVerification.checks.invalidUrlRejected ? 'PASS' : 'FAIL'}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>AFB-04 ตรวจจับหลักฐานเก่า (STALE)</span>
                            <span className={benchmarkEval.sourceVerification.checks.staleEvidenceFlagged ? 'text-emerald-300' : 'text-rose-300'}>
                              {benchmarkEval.sourceVerification.checks.staleEvidenceFlagged ? 'PASS' : 'FAIL'}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>AFB-07 ป้องกันรายงานสำเร็จเท็จ</span>
                            <span className={benchmarkEval.sourceVerification.checks.falseSuccessPrevented ? 'text-emerald-300' : 'text-rose-300'}>
                              {benchmarkEval.sourceVerification.checks.falseSuccessPrevented ? 'PASS' : 'FAIL'}
                            </span>
                          </li>
                        </ul>
                      </div>

                      <div className="rounded-2xl border border-slate-800 bg-[#070C18] p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-200">
                            Abstention Accuracy & Leakage Guard
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${
                              benchmarkEval.abstentionAccuracy.status === 'VERIFIED'
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            }`}
                          >
                            {benchmarkEval.abstentionAccuracy.status === 'VERIFIED' ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <AlertTriangle className="h-3.5 w-3.5" />
                            )}
                            <span>
                              {(benchmarkEval.abstentionAccuracy.overallAbstentionAccuracy * 100).toFixed(1)}%
                            </span>
                          </span>
                        </div>
                        <ul className="mt-3 space-y-1.5 text-[11px] text-slate-300 tabular-nums">
                          <li className="flex items-center justify-between">
                            <span>งดตอบเมื่อไม่รู้จริง (Negative Cases)</span>
                            <span>
                              {benchmarkEval.abstentionAccuracy.negativeCasesPassed}/
                              {benchmarkEval.abstentionAccuracy.negativeCasesTotal}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>False Positives (ตอบมั่ว / ข้ามขอบเขต)</span>
                            <span className={benchmarkEval.abstentionAccuracy.falsePositives === 0 ? 'text-emerald-300' : 'text-rose-300'}>
                              {benchmarkEval.abstentionAccuracy.falsePositives} (FPR {(benchmarkEval.abstentionAccuracy.falsePositiveRate * 100).toFixed(1)}%)
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>Negative Abstention Suite (NEG-01..07)</span>
                            <span>
                              {benchmarkEval.abstentionAccuracy.negativeAbstentionCategory.passed}/
                              {benchmarkEval.abstentionAccuracy.negativeAbstentionCategory.total}
                            </span>
                          </li>
                          <li className="flex items-center justify-between">
                            <span>Leakage Isolation / Near-Dup Guard</span>
                            <span className={benchmarkEval.report.leakage_detection.near_dup_leakage_caught ? 'text-emerald-300' : 'text-rose-300'}>
                              {benchmarkEval.report.leakage_detection.fixture_isolation.isolated &&
                              benchmarkEval.report.leakage_detection.near_dup_leakage_caught
                                ? 'VERIFIED'
                                : 'FAILED'}
                            </span>
                          </li>
                        </ul>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {Object.entries(benchmarkEval.report.category_scores).map(([cat, stats]) => (
                        <div
                          key={cat}
                          className="rounded-xl border border-slate-800/80 bg-[#070C18] px-3 py-2 text-xs tabular-nums"
                        >
                          <p className="truncate font-mono text-[11px] text-slate-400">{cat}</p>
                          <p className="mt-0.5 font-semibold text-slate-100">
                            {stats.passed}/{stats.total} ({(stats.score * 100).toFixed(1)}%)
                          </p>
                        </div>
                      ))}
                    </div>

                    {benchmarkEval.report.capability_ledger && (
                      <div className="rounded-2xl border border-slate-800 bg-[#070C18] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-100">
                            Real Capability Ledger — Measured, Not Declared (6 Subsystems)
                          </p>
                          <span className="font-mono text-[11px] text-cyan-300">
                            VERIFIED: {benchmarkEval.report.capability_ledger.summary.verified} · PARTIAL:{' '}
                            {benchmarkEval.report.capability_ledger.summary.partial} · BLOCKED:{' '}
                            {benchmarkEval.report.capability_ledger.summary.blocked} · REGRESSION:{' '}
                            {benchmarkEval.report.capability_ledger.summary.regression_failed}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {Object.values(benchmarkEval.report.capability_ledger.domains).map((dom) => {
                            const statusStyle =
                              dom.status === 'VERIFIED'
                                ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                                : dom.status === 'PARTIAL' || dom.status === 'TESTED'
                                ? 'border-amber-500/40 bg-amber-950/20 text-amber-200'
                                : dom.status === 'REGRESSION_FAILED' || dom.status === 'BLOCKED'
                                ? 'border-rose-500/40 bg-rose-950/20 text-rose-300'
                                : 'border-slate-700 bg-slate-900/40 text-slate-300';
                            return (
                              <div
                                key={dom.domain}
                                className="rounded-xl border border-slate-800/90 bg-[#0B1222] p-3 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] font-semibold text-slate-200">
                                    {dom.domain}
                                  </span>
                                  <span
                                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${statusStyle}`}
                                  >
                                    {dom.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-400">{dom.label}</p>
                                <p className="mt-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
                                  {dom.passed}/{dom.total} ({(dom.score * 100).toFixed(1)}%) · FP {dom.false_positives} · sha{' '}
                                  {dom.evidence_hash.slice(0, 8)}
                                </p>
                                <p className="mt-1 text-[10px] text-slate-400">
                                  Unseen:{dom.criteria.has_unseen_dataset ? '✓' : '✗'} · E2E:{dom.criteria.has_e2e_probe ? '✓' : '✗'} · Post:{dom.criteria.has_postcondition_check ? '✓' : '✗'}
                                </p>
                                {dom.disclosed_gaps.length > 0 && (
                                  <p className="mt-1.5 text-[10px] text-amber-200/90">
                                    {dom.disclosed_gaps[0]}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {benchmarkEval.report.failures.length > 0 && (
                      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/15 p-4">
                        <p className="text-xs font-semibold text-amber-200">
                          ข้อจำกัดและรายการที่ยังไม่ผ่าน ({benchmarkEval.report.failures.length} รายการ — แสดงผลตามจริงไม่ปกปิด)
                        </p>
                        <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                          {benchmarkEval.report.failures.map((f) => (
                            <div
                              key={f.id}
                              className="rounded-lg border border-slate-800/80 bg-[#070C18] px-3 py-2 text-[11px] text-slate-300"
                            >
                              <span className="font-mono font-semibold text-amber-300">[{f.id}]</span>{' '}
                              <span className="font-mono text-slate-400">({f.failure_type})</span>{' '}
                              <span>{f.input}</span>
                              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                                expected: {f.expected} | actual: {f.actual}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {benchmarkEval.report.unmeasurable_limitations.length > 0 && (
                      <div className="rounded-2xl border border-slate-800/80 bg-[#070C18] p-4">
                        <p className="text-xs font-semibold text-slate-300">
                          ขอบเขตที่ยังไม่สามารถวัดผลได้ในชุดทดสอบนี้ (Unmeasurable Limitations)
                        </p>
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                          {benchmarkEval.report.unmeasurable_limitations.map((item, idx) => (
                            <li key={idx}>• {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      การเรียนรู้จากความจำ &amp; Neural Transformer (P2)
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      คัดกรองข้อมูลจากความจำที่ยืนยันแล้ว และทดลองฝึก Native Transformer (Random Init + BPE) เพื่อขออนุมัติโปรโมต Checkpoint
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={curatingCorpus}
                      onClick={() => void handleCurateCorpus()}
                      className="min-h-[38px] rounded-xl border border-slate-700 bg-[#070C18] px-3.5 text-xs font-medium text-cyan-300 hover:border-cyan-500/60 disabled:opacity-50"
                    >
                      {curatingCorpus ? 'กำลังคัดกรอง...' : 'สร้างชุดข้อมูลจากความจำที่ยืนยันแล้ว'}
                    </button>
                    <button
                      type="button"
                      disabled={runningExperiment}
                      onClick={() => void handleRunNeuralExperiment()}
                      className="min-h-[38px] rounded-xl bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      {runningExperiment ? 'กำลังฝึกทดลอง...' : 'รันการทดลอง Neural Transformer'}
                    </button>
                  </div>
                </div>

                {experimentMsg && (
                  <p className="mt-3 text-xs text-cyan-300">{experimentMsg}</p>
                )}

                <div className="mt-4 divide-y divide-slate-800/80">
                  {(devData?.experiments || []).length === 0 ? (
                    <p className="py-3 text-xs text-slate-400">
                      ยังไม่มีประวัติการทดลอง Neural Transformer
                    </p>
                  ) : (
                    devData!.experiments!.map((exp) => {
                      let baseVal = '-';
                      let candVal = '-';
                      let params = '-';
                      try {
                        const b = JSON.parse(exp.baseline_metrics_json) as { initial_val_loss?: number };
                        const c = JSON.parse(exp.candidate_metrics_json) as {
                          final_val_loss?: number;
                          param_count?: number;
                        };
                        if (b.initial_val_loss !== undefined) baseVal = b.initial_val_loss.toFixed(4);
                        if (c.final_val_loss !== undefined) candVal = c.final_val_loss.toFixed(4);
                        if (c.param_count !== undefined) params = c.param_count.toLocaleString();
                      } catch {
                        /* ignore */
                      }
                      return (
                        <div key={exp.id} className="py-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-slate-100">{exp.hypothesis}</span>
                            <span className="font-mono text-cyan-300">{exp.approval_status}</span>
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
                            val_loss: {baseVal} → {candVal} · params: {params}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <ToolRegistry
                token={token}
                userRole={user.role}
                mode="developer"
                toolsData={toolsData}
                onRefresh={loadDeveloper}
                onError={setError}
              />
            </>
          )}
        </div>
      )}

      {/* TAB 3: ผู้ดูแลระบบ */}
      {activeTab === 'admin' && user.role === 'admin' && (
        <div className="space-y-6">
          {loading && !adminData ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0E172B] p-6 text-sm text-slate-400">
              กำลังโหลดระบบธรรมาภิบาล...
            </div>
          ) : (
            <>
              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <h3 className="text-base font-semibold text-slate-100">
                  คิวรออนุมัติเวิร์กโฟลว์ (Approval Gate)
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  อนุมัติหรือปฏิเสธงานที่มีผลต่อการฝึกโมเดลหรือการปรับแต่งระบบ
                </p>
                <div className="mt-4 divide-y divide-slate-800/80">
                  {(adminData?.pending_runs || []).length === 0 ? (
                    <p className="py-3 text-sm text-slate-400">
                      ไม่มีรายการเวิร์กโฟลว์ที่รออนุมัติในขณะนี้
                    </p>
                  ) : (
                    adminData!.pending_runs.map((run) => (
                      <div
                        key={run.id}
                        className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{run.group_id}</p>
                          <p className="text-xs text-slate-400">{run.summary}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleApprovalDecision(run.id, 'approve')}
                            className="flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-500"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>อนุมัติ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApprovalDecision(run.id, 'reject')}
                            className="flex h-10 items-center gap-1.5 rounded-xl border border-rose-500/40 px-4 text-xs font-medium text-rose-200 hover:bg-rose-950/40"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>ปฏิเสธ</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <h3 className="text-base font-semibold text-slate-100">
                  คิวอนุมัติ Neural Experiment (Self-Improvement Gate)
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  อนุมัติเพื่อโปรโมต Candidate Neural Checkpoint ที่ผ่านเกณฑ์ลด Val Loss
                </p>
                <div className="mt-4 divide-y divide-slate-800/80">
                  {(adminData?.pending_experiments || []).length === 0 ? (
                    <p className="py-3 text-sm text-slate-400">
                      ไม่มีการทดลองที่รอการอนุมัติในขณะนี้
                    </p>
                  ) : (
                    adminData!.pending_experiments!.map((exp) => {
                      let metricsInfo = '';
                      try {
                        const b = JSON.parse(exp.baseline_metrics_json) as { initial_val_loss?: number };
                        const c = JSON.parse(exp.candidate_metrics_json) as {
                          final_val_loss?: number;
                          val_perplexity?: number;
                        };
                        metricsInfo = `val_loss: ${b.initial_val_loss?.toFixed(4) ?? '-'} → ${c.final_val_loss?.toFixed(4) ?? '-'} (ppl ${c.val_perplexity?.toFixed(2) ?? '-'})`;
                      } catch {
                        // ignore malformed metrics JSON
                      }
                      return (
                        <div
                          key={exp.id}
                          className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-100">{exp.hypothesis}</p>
                            {metricsInfo && (
                              <p className="mt-0.5 font-mono text-xs text-slate-400 tabular-nums">
                                {metricsInfo}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleExperimentDecision(exp.id, 'approve')}
                              className="flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-500"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>อนุมัติโปรโมต Checkpoint</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleExperimentDecision(exp.id, 'reject')}
                              className="flex h-10 items-center gap-1.5 rounded-xl border border-rose-500/40 px-4 text-xs font-medium text-rose-200 hover:bg-rose-950/40"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>ปฏิเสธ</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <ToolRegistry
                token={token}
                userRole={user.role}
                mode="admin"
                pendingInvocations={adminData?.pending_tool_invocations || []}
                adminTools={adminData?.tools || []}
                onRefresh={loadAdmin}
                onError={setError}
              />

              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <h3 className="text-base font-semibold text-slate-100">จัดการสิทธิ์ผู้ใช้งาน</h3>
                <div className="mt-4 divide-y divide-slate-800/80">
                  {(adminData?.users || []).map((u) => (
                    <div
                      key={u.id}
                      className="flex min-h-[56px] items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {u.display_name}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {u.email} · {u.role}
                        </p>
                      </div>
                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleRoleChange(u.id, u.role === 'admin' ? 'user' : 'admin')
                          }
                          className="min-h-[40px] shrink-0 rounded-xl border border-slate-700 px-3 text-xs font-medium text-slate-200 hover:border-cyan-400"
                        >
                          {u.role === 'admin' ? 'ลดสิทธิ์เป็น User' : 'ตั้งเป็นผู้ดูแล'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
                <h3 className="text-base font-semibold text-slate-100">บันทึกการตรวจสอบความปลอดภัย</h3>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 pr-4 font-medium">เวลา</th>
                        <th className="py-2 pr-4 font-medium">ผู้ดำเนินการ</th>
                        <th className="py-2 pr-4 font-medium">การกระทำ</th>
                        <th className="py-2 font-medium">ผลลัพธ์</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 tabular-nums">
                      {(adminData?.audit_logs || []).map((log) => (
                        <tr key={log.id}>
                          <td className="py-2.5 pr-4 font-mono text-slate-400">
                            {new Date(log.created_at).toLocaleString('th-TH')}
                          </td>
                          <td className="py-2.5 pr-4 text-slate-200">{log.actor_email}</td>
                          <td className="py-2.5 pr-4 font-mono text-cyan-300">{log.action}</td>
                          <td className="py-2.5 text-slate-300">{log.outcome}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
