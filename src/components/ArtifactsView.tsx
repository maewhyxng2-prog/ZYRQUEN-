import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, FileText, RefreshCw } from 'lucide-react';
import { ApiError, apiRequest } from '../lib/api';

interface WorkspaceFile {
  name: string;
  size_bytes: number;
  modified_at?: string;
}

interface ToolsOverviewResponse {
  workspace_files?: WorkspaceFile[];
}

interface FileReadResponse {
  ok: boolean;
  status?: string;
  invocation?: {
    result?: {
      content?: string;
      filename?: string;
      size_bytes?: number;
    };
    output?: { content?: string; filename?: string };
    [key: string]: unknown;
  };
  error?: string;
}

export function ArtifactsView({ token }: { token: string }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newFilename, setNewFilename] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<ToolsOverviewResponse>('/api/developer/tools', { token });
      setFiles(result.workspace_files || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'โหลดคลังผลงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  async function saveArtifact(event: React.FormEvent) {
    event.preventDefault();
    if (!newFilename.trim() || !newContent.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/developer/workspace-files', {
        method: 'POST',
        token,
        body: { filename: newFilename.trim(), content: newContent },
      });
      setNewFilename('');
      setNewContent('');
      await loadFiles();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'บันทึกผลงานไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function openFile(file: WorkspaceFile) {
    setSelectedName(file.name);
    setContent(null);
    setError(null);
    try {
      const result = await apiRequest<FileReadResponse>('/api/developer/tools/workspace_file_read/invoke', {
        method: 'POST',
        token,
        body: { input: { action: 'read', filename: file.name } },
      });
      const output = result.raw_output || {};
      if (!result.ok || typeof output.content !== 'string') {
        throw new Error(result.error || 'ไม่สามารถอ่านไฟล์ได้');
      }
      setContent(output.content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ');
    }
  }

  async function copyContent() {
    if (content === null) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('คัดลอกไม่ได้ กรุณาตรวจสอบสิทธิ์ Clipboard ของเบราว์เซอร์');
    }
  }

  function downloadContent() {
    if (content === null || !selectedName) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = selectedName.split('/').pop() || 'artifact.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">WORKSPACE / ARTIFACTS</p>
          <h2 className="mt-1 text-2xl font-bold text-[var(--color-text)]">คลังผลงาน</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">ไฟล์ที่บันทึกไว้ในพื้นที่ทำงานจริงของ ZYRQUEN</p>
        </div>
        <button type="button" onClick={() => void loadFiles()} disabled={loading} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> รีเฟรช
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger-bg)] px-4 py-3 text-sm text-[var(--color-danger)]">{error}</div>}

      <form onSubmit={saveArtifact} className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 sm:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.5fr)_auto] sm:items-end">
        <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">ชื่อไฟล์
          <input value={newFilename} onChange={(event) => setNewFilename(event.target.value)} maxLength={96} placeholder="report.md" className="min-h-[40px] w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]" />
        </label>
        <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">เนื้อหาผลงาน
          <textarea value={newContent} onChange={(event) => setNewContent(event.target.value)} rows={2} maxLength={50000} placeholder="วางเนื้อหาผลงานที่ต้องการบันทึก..." className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-focus)]" />
        </label>
        <button type="submit" disabled={saving || !newFilename.trim() || !newContent.trim()} className="min-h-[40px] rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'กำลังบันทึก...' : 'บันทึกผลงาน'}</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">ไฟล์ที่บันทึกไว้ ({files.length})</h3>
          </div>
          {loading ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">กำลังโหลดไฟล์...</p> : files.length === 0 ? (
            <div className="p-6 text-center">
              <FileText className="mx-auto h-8 w-8 text-[var(--color-text-muted)]" />
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">ยังไม่มีไฟล์ในคลังผลงาน</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {files.map((file) => (
                <li key={file.name}>
                  <button type="button" onClick={() => void openFile(file)} className={`flex min-h-[58px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] ${selectedName === file.name ? 'bg-[var(--color-surface-hover)]' : ''}`}>
                    <FileText className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--color-text)]">{file.name}</span>
                      <span className="text-xs text-[var(--color-text-muted)]">{Math.ceil(file.size_bytes / 1024)} KB</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="min-h-[320px] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
          <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">{selectedName || 'ตัวอย่างไฟล์'}</h3>
            <div className="flex gap-2">
              <button type="button" onClick={() => void copyContent()} disabled={content === null} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 text-xs text-[var(--color-text-secondary)] disabled:opacity-40">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
              <button type="button" onClick={downloadContent} disabled={content === null} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 text-xs text-[var(--color-text-secondary)] disabled:opacity-40">
                <Download className="h-3.5 w-3.5" /> ดาวน์โหลด
              </button>
            </div>
          </div>
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-relaxed text-[var(--color-text-secondary)]">{content ?? 'เลือกไฟล์จากรายการเพื่อดูเนื้อหา'}</pre>
        </section>
      </div>
    </div>
  );
}
