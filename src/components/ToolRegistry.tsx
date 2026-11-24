import React, { useState } from 'react';
import { Check, ShieldCheck, Wrench, X } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import { canRoleExecuteTool, externalToolAdapter, type ToolAuditEntry, type ToolId } from '../lib/tools';
import type { ExternalToolItem, ToolInvocationItem, ToolsOverview } from '../types';

interface ToolRegistryProps {
  token: string;
  userRole: 'admin' | 'user';
  mode: 'developer' | 'admin';
  toolsData?: ToolsOverview | null;
  pendingInvocations?: ToolInvocationItem[];
  adminTools?: ExternalToolItem[];
  onRefresh: () => Promise<void> | void;
  onError?: (message: string) => void;
}

export function ToolRegistry({
  token,
  userRole,
  mode,
  toolsData,
  pendingInvocations = [],
  adminTools = [],
  onRefresh,
  onError,
}: ToolRegistryProps) {
  const [selectedToolId, setSelectedToolId] = useState<ToolId>('web_search');
  const [toolParam, setToolParam] = useState('');
  const [toolMessage, setToolMessage] = useState<string | null>(null);
  const [invokingTool, setInvokingTool] = useState(false);
  const [wsFilename, setWsFilename] = useState('');
  const [wsContent, setWsContent] = useState('');
  const [adapterAudit, setAdapterAudit] = useState<ToolAuditEntry[]>([]);

  const devTools = toolsData?.tools || [];
  const selectedTool = devTools.find((t) => t.id === selectedToolId);

  async function handleInvokeTool(e: React.FormEvent) {
    e.preventDefault();
    setInvokingTool(true);
    setToolMessage(null);
    try {
      const payloadInput: Record<string, unknown> =
        selectedToolId === 'web_search'
          ? { query: toolParam }
          : selectedToolId === 'doc_fetch'
            ? { url: toolParam }
            : selectedToolId === 'calc_ast'
              ? { expression: toolParam }
              : toolParam.trim()
                ? { action: 'read', filename: toolParam.trim() }
                : { action: 'list' };

      const res = await externalToolAdapter.run(selectedToolId, payloadInput, token, {
        toolPolicy: selectedTool,
        userRole,
      });

      setAdapterAudit(
        externalToolAdapter.audit({
          toolId: selectedToolId,
          action: 'REGISTRY_CLIENT_CHECK',
          outcome: res.status,
          invocationId: res.invocation?.id,
          trustGrade: res.analysis?.trust_grade,
          timestamp: new Date().toISOString(),
          detail: res.analysis?.summary || res.error,
        })
      );

      if (!res.ok) {
        setToolMessage(res.error || 'การเรียกเครื่องมือไม่ผ่านเงื่อนไข');
        return;
      }

      setToolMessage(
        res.analysis?.summary ||
          res.invocation?.analysis_summary ||
          `สถานะเครื่องมือ: ${res.status}`
      );
      await onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'เรียกใช้เครื่องมือไม่สำเร็จ';
      setToolMessage(msg);
      onError?.(msg);
    } finally {
      setInvokingTool(false);
    }
  }

  async function handleSaveWorkspaceFile(e: React.FormEvent) {
    e.preventDefault();
    setToolMessage(null);
    try {
      await apiRequest('/api/developer/workspace-files', {
        method: 'POST',
        token,
        body: { filename: wsFilename, content: wsContent },
      });
      setToolMessage(`บันทึกไฟล์ "${wsFilename}" ลงใน workspace_files แล้ว`);
      setWsFilename('');
      setWsContent('');
      await onRefresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'บันทึกไฟล์ไม่สำเร็จ';
      onError?.(msg);
    }
  }

  async function handleToolInvocationDecision(
    invocationId: string,
    decision: 'approve' | 'reject'
  ) {
    try {
      await apiRequest(`/api/admin/tool-invocations/${invocationId}/decide`, {
        method: 'POST',
        token,
        body: { decision },
      });
      await onRefresh();
    } catch (err) {
      onError?.(err instanceof ApiError ? err.message : 'อนุมัติเครื่องมือภายนอกไม่สำเร็จ');
    }
  }

  async function handleUpdateToolPolicy(
    toolId: string,
    patch: { permission_mode?: ExternalToolItem['permission_mode']; quota_daily?: number }
  ) {
    try {
      await apiRequest(`/api/admin/tools/${toolId}`, {
        method: 'PATCH',
        token,
        body: patch,
      });
      await onRefresh();
    } catch (err) {
      onError?.(err instanceof ApiError ? err.message : 'อัปเดตสิทธิ์เครื่องมือไม่สำเร็จ');
    }
  }

  if (mode === 'admin') {
    return (
      <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-300" />
          <h3 className="text-base font-semibold text-slate-100">
            Tool Approval Gate & นโยบายสิทธิ์เครื่องมือภายนอก
          </h3>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          อนุมัติคำขอเรียกใช้เครื่องมือภายนอกตามสิทธิ์บทบาท ({userRole}) และกำหนดระดับนโยบาย P5 Approval Gate
        </p>

        <div className="mt-4 divide-y divide-slate-800/80">
          {pendingInvocations.length === 0 ? (
            <p className="py-3 text-sm text-slate-400">
              ไม่มีคำขอเรียกใช้เครื่องมือภายนอกที่รออนุมัติ
            </p>
          ) : (
            pendingInvocations.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-mono text-sm font-semibold text-cyan-300">{inv.tool_id}</p>
                  <p className="text-xs text-slate-300">{inv.input_json}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleToolInvocationDecision(inv.id, 'approve')}
                    className="flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>อนุมัติเครื่องมือ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToolInvocationDecision(inv.id, 'reject')}
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

        {adminTools.length > 0 && (
          <div className="mt-4 divide-y divide-slate-800/80 border-t border-slate-800/80 pt-3">
            {adminTools.map((tl) => {
              const roleStatus = canRoleExecuteTool(tl, userRole);
              return (
                <div
                  key={tl.id}
                  className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-100">{tl.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">
                      {tl.id} · โควตา {tl.calls_today}/{tl.quota_daily} · {roleStatus.modeLabel}
                    </p>
                  </div>
                  <select
                    aria-label={`สิทธิ์ ${tl.id}`}
                    value={tl.permission_mode}
                    onChange={(e) =>
                      void handleUpdateToolPolicy(tl.id, {
                        permission_mode: e.target.value as ExternalToolItem['permission_mode'],
                      })
                    }
                    className="h-9 rounded-lg border border-slate-700 bg-[#070C18] px-2.5 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="approval_required">ต้องอนุมัติ (approval_required)</option>
                    <option value="auto">อัตโนมัติ (auto)</option>
                    <option value="disabled">ปิดการใช้งาน (disabled)</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-800/90 bg-[#0E172B] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-cyan-300" />
          <h3 className="text-base font-semibold text-slate-100">
            Tool Registry & โควตาเครื่องมือภายนอก
          </h3>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          บทบาทปัจจุบัน: {userRole}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        เครื่องมือเสริมที่ทำงานผ่านสัญญา ExternalToolAdapter ภายใต้การควบคุมสิทธิ์ของ Native AI Core (ไม่เชื่อมต่อ LLM ภายนอก)
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {devTools.map((tl) => {
          const allowlist = (() => {
            try {
              return JSON.parse(tl.endpoint_allowlist_json || '[]') as string[];
            } catch {
              return [];
            }
          })();
          const roleStatus = canRoleExecuteTool(tl, userRole);
          return (
            <div key={tl.id} className="rounded-2xl border border-slate-800 bg-[#070C18] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-100">{tl.name}</span>
                <span className="rounded-md border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                  {tl.permission_mode}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{tl.description}</p>
              <p className="mt-2 font-mono text-[11px] text-slate-300 tabular-nums">
                โควตาวันนี้: {tl.calls_today}/{tl.quota_daily}
                {allowlist.length > 0 ? ` · allow: ${allowlist.join(', ')}` : ''}
              </p>
              <p className="mt-1 text-[11px] text-cyan-300/90">{roleStatus.modeLabel}</p>
            </div>
          );
        })}
      </div>

      <form onSubmit={handleInvokeTool} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <select
          aria-label="เลือกเครื่องมือ"
          value={selectedToolId}
          onChange={(e) => setSelectedToolId(e.target.value as ToolId)}
          className="h-11 rounded-xl border border-slate-800 bg-[#070C18] px-3 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
        >
          <option value="web_search">web_search (ค้นหาเว็บ)</option>
          <option value="doc_fetch">doc_fetch (อ่าน URL)</option>
          <option value="calc_ast">calc_ast (คำนวณ AST)</option>
          <option value="workspace_file_read">workspace_file_read (อ่านไฟล์)</option>
        </select>
        <input
          type="text"
          value={toolParam}
          onChange={(e) => setToolParam(e.target.value)}
          placeholder={
            selectedToolId === 'web_search'
              ? 'คำค้นสาธารณะ (เช่น SQLite)'
              : selectedToolId === 'doc_fetch'
                ? 'https://en.wikipedia.org/wiki/SQLite'
                : selectedToolId === 'calc_ast'
                  ? 'แก้สมการ: 3x + 7 = 22'
                  : 'ชื่อไฟล์ (ว่างเพื่อดูรายการ)'
          }
          className="h-11 flex-1 rounded-xl border border-slate-800 bg-[#070C18] px-3.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={invokingTool}
          className="h-11 rounded-xl bg-blue-600 px-5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
        >
          {invokingTool ? 'กำลังเรียก...' : 'เรียกเครื่องมือ'}
        </button>
      </form>

      {toolMessage && <p className="mt-2.5 text-xs text-cyan-300">{toolMessage}</p>}

      <form
        onSubmit={handleSaveWorkspaceFile}
        className="mt-5 grid gap-2 border-t border-slate-800/80 pt-4 sm:grid-cols-3"
      >
        <input
          type="text"
          required
          value={wsFilename}
          onChange={(e) => setWsFilename(e.target.value)}
          placeholder="ชื่อไฟล์ (เช่น notes.txt)"
          className="h-10 rounded-xl border border-slate-800 bg-[#070C18] px-3 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
        />
        <input
          type="text"
          required
          value={wsContent}
          onChange={(e) => setWsContent(e.target.value)}
          placeholder="เนื้อหาข้อความสำหรับเครื่องมืออ่านไฟล์..."
          className="h-10 rounded-xl border border-slate-800 bg-[#070C18] px-3 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
        />
        <button
          type="submit"
          className="h-10 rounded-xl border border-slate-700 bg-[#070C18] px-4 text-xs font-medium text-cyan-300 hover:border-cyan-500/60"
        >
          บันทึกไฟล์ใน Sandbox
        </button>
      </form>

      {((toolsData?.invocations || []).length > 0 || adapterAudit.length > 0) && (
        <div className="mt-4 divide-y divide-slate-800/70 border-t border-slate-800/80 pt-2">
          {(toolsData?.invocations || []).slice(0, 5).map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-cyan-300">{inv.tool_id}</span>{' '}
                <span className="text-slate-400">· {inv.analysis_summary || inv.input_json}</span>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-slate-300">{inv.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
