import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Database,
  KeyRound,
  LogOut,
  Shield,
  Terminal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import { ToolRegistry } from './ToolRegistry';
import type {
  AdminOverview,
  DeveloperOverview,
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
