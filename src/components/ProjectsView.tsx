import React, { useCallback, useEffect, useState } from 'react';
import { Archive, FolderKanban, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ApiError, apiRequest } from '../lib/api';

interface WorkspaceProject {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

interface ProjectsResponse {
  projects: WorkspaceProject[];
}

interface ProjectResponse {
  project: WorkspaceProject;
}

export function ProjectsView({ token }: { token: string }) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<ProjectsResponse>('/api/projects', { token });
      setProjects(result.projects);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดโปรเจกต์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiRequest<ProjectResponse>('/api/projects', {
        method: 'POST',
        token,
        body: { name: cleanName, description: description.trim() },
      });
      setProjects((current) => [result.project, ...current]);
      setName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'สร้างโปรเจกต์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(project: WorkspaceProject) {
    const status = project.status === 'active' ? 'archived' : 'active';
    try {
      const result = await apiRequest<ProjectResponse>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        token,
        body: { name: project.name, description: project.description, status },
      });
      setProjects((current) => current.map((item) => item.id === project.id ? result.project : item));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เปลี่ยนสถานะโปรเจกต์ไม่สำเร็จ');
    }
  }

  async function deleteProject(project: WorkspaceProject) {
    if (!window.confirm(`ลบโปรเจกต์ "${project.name}" หรือไม่?`)) return;
    try {
      await apiRequest<{ ok: boolean }>(`/api/projects/${project.id}`, { method: 'DELETE', token });
      setProjects((current) => current.filter((item) => item.id !== project.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ลบโปรเจกต์ไม่สำเร็จ');
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">WORKSPACE / PROJECTS</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--color-text)]">โปรเจกต์</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">จัดเก็บและติดตามพื้นที่ทำงานของคุณ</p>
        </div>
        <button type="button" onClick={() => void loadProjects()} disabled={loading} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> รีเฟรช
        </button>
      </header>

      <form onSubmit={createProject} className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]"><Plus className="h-4 w-4 text-[var(--color-accent)]" /> สร้างโปรเจกต์</div>
        <input aria-label="ชื่อโปรเจกต์" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="ชื่อโปรเจกต์" className="min-h-[44px] w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]" />
        <textarea aria-label="รายละเอียดโปรเจกต์" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} placeholder="รายละเอียดหรือเป้าหมายของโปรเจกต์ (ไม่บังคับ)" className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]" />
        <button type="submit" disabled={!name.trim() || saving} className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} บันทึกโปรเจกต์
        </button>
      </form>

      {error && <div role="alert" className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</div>}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">โปรเจกต์ทั้งหมด</h3>
          <span className="text-xs tabular-nums text-[var(--color-text-muted)]">{projects.length} รายการ</span>
        </div>
        {loading ? (
          <div className="rounded-2xl border border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-secondary)]">กำลังโหลดโปรเจกต์...</div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--color-border)] p-10 text-center">
            <FolderKanban className="h-8 w-8 text-[var(--color-text-muted)]" />
            <p className="text-sm font-medium text-[var(--color-text)]">ยังไม่มีโปรเจกต์</p>
            <p className="text-xs text-[var(--color-text-secondary)]">สร้างโปรเจกต์แรกเพื่อเริ่มจัดระเบียบงาน</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {projects.map((project) => (
              <article key={project.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-[var(--color-text)]">{project.name}</h4>
                    <p className="mt-1 min-h-10 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-secondary)]">{project.description || 'ไม่มีรายละเอียด'}</p>
                    <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">อัปเดต {new Date(project.updated_at).toLocaleString('th-TH')}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${project.status === 'active' ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]' : 'bg-[var(--color-surface)] text-[var(--color-text-muted)]'}`}>{project.status === 'active' ? 'กำลังดำเนินการ' : 'เก็บถาวร'}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
                  <button type="button" onClick={() => void toggleArchive(project)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                    <Archive className="h-3.5 w-3.5" /> {project.status === 'active' ? 'เก็บถาวร' : 'นำกลับมา'}
                  </button>
                  <button type="button" onClick={() => void deleteProject(project)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]">
                    <Trash2 className="h-3.5 w-3.5" /> ลบ
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
