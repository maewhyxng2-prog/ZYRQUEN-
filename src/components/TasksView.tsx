import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, Play, Plus, RefreshCw, Square } from 'lucide-react';
import { ApiError, apiRequest } from '../lib/api';

interface Mission {
  id: string;
  goal: string;
  status: string;
  created_at: string;
  updated_at: string;
  report_markdown?: string;
  stages_json?: string;
}

interface MissionsResponse {
  missions: Mission[];
}

interface MissionResponse {
  mission: Mission;
}

export function TasksView({ token }: { token: string }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Mission | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<MissionsResponse>('/api/autonomous/missions', { token });
      setMissions(result.missions || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดรายการงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function runTask(event: React.FormEvent) {
    event.preventDefault();
    const cleanGoal = goal.trim();
    if (!cleanGoal || running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await apiRequest<MissionResponse>('/api/autonomous/missions', {
        method: 'POST',
        token,
        body: {
          goal: cleanGoal,
          enableResearch: false,
          enableKnowledgeDev: false,
          enablePlanning: true,
          enableExecution: true,
        },
      });
      setGoal('');
      setSelected(result.mission);
      await loadTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เริ่มดำเนินงานไม่สำเร็จ');
    } finally {
      setRunning(false);
    }
  }

  async function updateTaskAction(task: Mission, action: 'resume' | 'cancel') {
    setError(null);
    try {
      const result = await apiRequest<MissionResponse>(`/api/autonomous/missions/${task.id}/${action}`, {
        method: 'POST',
        token,
        body: {},
      });
      if (result.mission) setSelected(result.mission);
      await loadTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'อัปเดตงานไม่สำเร็จ');
    }
  }

  function statusLabel(status: string) {
    const normalized = status.toUpperCase();
    if (normalized === 'COMPLETED') return 'เสร็จแล้ว';
    if (normalized === 'RUNNING') return 'กำลังทำงาน';
    if (normalized === 'PENDING_APPROVAL') return 'รออนุมัติ';
    if (normalized === 'FAILED') return 'ไม่สำเร็จ';
    if (normalized === 'CANCELLED') return 'ยกเลิกแล้ว';
    return status;
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">WORKSPACE / TASKS</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--color-text)]">งานของฉัน</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">มอบหมายเป้าหมาย ติดตามการดำเนินงาน และตรวจสอบผลลัพธ์</p>
        </div>
        <button type="button" onClick={() => void loadTasks()} disabled={loading} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> รีเฟรช
        </button>
      </header>

      <form onSubmit={runTask} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]"><Plus className="h-4 w-4 text-[var(--color-accent)]" /> มอบหมายงานใหม่</div>
        <textarea aria-label="เป้าหมายงาน" value={goal} onChange={(event) => setGoal(event.target.value)} rows={3} maxLength={400} placeholder="ระบุเป้าหมายที่ต้องการให้ ZYRQUEN ดำเนินการ..." className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-text-muted)]">การส่งงานนี้จะเริ่ม Native Mission ตามสิทธิ์และความสามารถที่เปิดใช้งาน</p>
          <button type="submit" disabled={!goal.trim() || running} className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">
            {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} เริ่มดำเนินงาน
          </button>
        </div>
      </form>

      {error && <div role="alert" className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">ประวัติการดำเนินงาน ({missions.length})</h3>
          </div>
          {loading ? <p className="p-6 text-sm text-[var(--color-text-secondary)]">กำลังโหลดงาน...</p> : missions.length === 0 ? (
            <p className="p-8 text-center text-sm text-[var(--color-text-secondary)]">ยังไม่มีงานที่ดำเนินการ</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {missions.map((task) => (
                <li key={task.id}>
                  <button type="button" onClick={() => setSelected(task)} className={`flex min-h-[76px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] ${selected?.id === task.id ? 'bg-[var(--color-surface-hover)]' : ''}`}>
                    {task.status.toUpperCase() === 'COMPLETED' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success)]" /> : task.status.toUpperCase() === 'FAILED' ? <CircleAlert className="h-5 w-5 shrink-0 text-[var(--color-danger)]" /> : <CircleAlert className="h-5 w-5 shrink-0 text-[var(--color-accent)]" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--color-text)]">{task.goal}</span>
                      <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{statusLabel(task.status)} · {new Date(task.updated_at || task.created_at).toLocaleString('th-TH')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-h-[260px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">รายละเอียดงาน</h3>
          {selected ? (
            <>
              <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--color-text)]">{selected.goal}</p>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">สถานะ: {statusLabel(selected.status)}</p>
              {selected.report_markdown && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--color-surface)] p-3 text-xs text-[var(--color-text-secondary)]">{selected.report_markdown}</pre>}
              <div className="mt-4 flex flex-wrap gap-2">
                {['FAILED', 'PAUSED'].includes(selected.status.toUpperCase()) && <button type="button" onClick={() => void updateTaskAction(selected, 'resume')} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs text-[var(--color-text)]"><Play className="h-3.5 w-3.5" /> ทำต่อ</button>}
                {['RUNNING', 'PENDING_APPROVAL'].includes(selected.status.toUpperCase()) && <button type="button" onClick={() => void updateTaskAction(selected, 'cancel')} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs text-[var(--color-danger)]"><Square className="h-3.5 w-3.5" /> ยกเลิก</button>}
              </div>
            </>
          ) : <p className="mt-3 text-sm text-[var(--color-text-secondary)]">เลือกงานจากรายการเพื่อดูรายละเอียดและผลลัพธ์</p>}
        </section>
      </div>
    </div>
  );
}
