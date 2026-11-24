// @vitest-environment node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NativeBenchmarkReport } from '../types';

describe('Full-Stack Real E2E: Express + SQLite + Python Native Core (Zero Fetch Mocks)', () => {
  let server: http.Server;
  let baseUrl = '';
  let tmpDataDir = '';
  let prevDataDir: string | undefined;
  let prevNoAutostart: string | undefined;

  beforeAll(async () => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyrquen-e2e-http-'));
    prevDataDir = process.env.ZYRQUEN_DATA_DIR;
    prevNoAutostart = process.env.ZYRQUEN_NO_AUTOSTART;
    process.env.ZYRQUEN_DATA_DIR = tmpDataDir;
    process.env.ZYRQUEN_NO_AUTOSTART = '1';

    const { createApp } = await import('../../server');
    const app = await createApp({ attachVite: false });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral E2E server port');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    if (prevDataDir === undefined) {
      delete process.env.ZYRQUEN_DATA_DIR;
    } else {
      process.env.ZYRQUEN_DATA_DIR = prevDataDir;
    }
    if (prevNoAutostart === undefined) {
      delete process.env.ZYRQUEN_NO_AUTOSTART;
    } else {
      process.env.ZYRQUEN_NO_AUTOSTART = prevNoAutostart;
    }
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('Executes real Auth -> Inference -> KG Memory -> Autonomous DAG Mission -> 7-State Capability Benchmark over HTTP', async () => {
    // 1. Health & Uninitialized Auth Status
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean; nativeCore: string };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.nativeCore).toBe('ready');

    // 2. Claim initial admin account in fresh SQLite DB
    const setupRes = await fetch(`${baseUrl}/api/auth/claim-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'e2e-admin@zyrquen.local',
        displayName: 'E2E Admin',
        password: 'StrongPassword123!',
      }),
    });
    expect(setupRes.status).toBe(201);
    const setupJson = (await setupRes.json()) as { token: string; user: { role: string } };
    expect(setupJson.token).toBeTruthy();
    expect(setupJson.user.role).toBe('admin');

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${setupJson.token}`,
    };

    const adminOverviewInit = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: authHeaders,
    });
    expect(adminOverviewInit.status).toBe(200);
    const adminOverviewJson = (await adminOverviewInit.json()) as {
      training_readiness?: { gate_status: string; datasets_total: number; clean_datasets: number };
    };
    expect(adminOverviewJson.training_readiness?.gate_status).toBe('BLOCKED');
    expect(adminOverviewJson.training_readiness?.datasets_total).toBe(0);
    expect(adminOverviewJson.training_readiness?.clean_datasets).toBe(0);

    // 3. Create conversation & test real Python AST math + KG learn/recall + OOD abstention
    const convRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ title: 'E2E Verification', mode: 'auto' }),
    });
    expect(convRes.status).toBe(201);
    const convJson = (await convRes.json()) as { conversation: { id: string } };
    const cid = convJson.conversation.id;

    const mathRes = await fetch(`${baseUrl}/api/conversations/${cid}/messages`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content: 'คำนวณ (10 + 15) * 4', mode: 'auto', modelVariant: 'zyrquen-omega-v1' }),
    });
    expect(mathRes.status).toBe(201);
    const mathJson = (await mathRes.json()) as {
      assistant_message: { status: string; content: string; trace_json: string };
    };
    expect(mathJson.assistant_message.status).toBe('VERIFIED');
    const mathTrace = JSON.parse(mathJson.assistant_message.trace_json) as {
      math?: { result?: number };
      external_models_used: boolean;
      task_timings?: Array<{ task: string; duration_ms: number; matched: boolean; status: string }>;
      bottleneck_task?: { task: string; duration_ms: number; share_pct: number } | null;
    };
    expect(mathTrace.math?.result).toBe(100);
    expect(mathTrace.external_models_used).toBe(false);
    expect(Array.isArray(mathTrace.task_timings)).toBe(true);
    expect(mathTrace.task_timings!.length).toBeGreaterThan(0);
    expect(mathTrace.task_timings!.every((t) => typeof t.duration_ms === 'number' && t.duration_ms >= 0)).toBe(true);
    expect(mathTrace.bottleneck_task).toBeTruthy();
    expect(typeof mathTrace.bottleneck_task?.duration_ms).toBe('number');

    // Unseen OOD question must abstain honestly (NOT_LEARNED)
    const oodRes = await fetch(`${baseUrl}/api/conversations/${cid}/messages`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ content: 'ทฤษฎีสัมพัทธภาพทั่วไปคืออะไร', mode: 'auto' }),
    });
    expect(oodRes.status).toBe(201);
    const oodJson = (await oodRes.json()) as {
      assistant_message: { status: string; trace_json: string };
    };
    expect(oodJson.assistant_message.status).toBe('NOT_LEARNED');
    const oodTrace = JSON.parse(oodJson.assistant_message.trace_json) as {
      task_timings?: Array<{ task: string; duration_ms: number }>;
      bottleneck_task?: { task: string; duration_ms: number } | null;
    };
    expect(oodTrace.task_timings?.some((t) => t.task === 'unlearned_boundary')).toBe(true);
    expect(oodTrace.bottleneck_task).toBeTruthy();

    // Verify persistent Reasoning Trace stored in SQLite & exposed via workflows endpoints
    const wfRes = await fetch(`${baseUrl}/api/workflows`, { headers: authHeaders });
    expect(wfRes.status).toBe(200);
    const wfJson = (await wfRes.json()) as {
      ok: boolean;
      reasoning_traces: Array<{
        prompt: string;
        status: string;
        engine_path_json: string;
        external_models_used: number;
      }>;
    };
    expect(wfJson.ok).toBe(true);
    expect(wfJson.reasoning_traces.length).toBeGreaterThanOrEqual(2);
    const persistedMath = wfJson.reasoning_traces.find((t) => t.prompt.includes('(10 + 15) * 4'));
    expect(persistedMath).toBeDefined();
    expect(persistedMath?.status).toBe('VERIFIED');
    expect(persistedMath?.external_models_used).toBe(0);
    expect(JSON.parse(persistedMath!.engine_path_json)).toContain('math_ast');

    const traceFilterRes = await fetch(
      `${baseUrl}/api/workflows/reasoning-traces?status=NOT_LEARNED`,
      { headers: authHeaders }
    );
    expect(traceFilterRes.status).toBe(200);
    const traceFilterJson = (await traceFilterRes.json()) as {
      ok: boolean;
      reasoning_traces: Array<{ prompt: string; status: string }>;
    };
    expect(traceFilterJson.ok).toBe(true);
    expect(traceFilterJson.reasoning_traces.some((t) => t.status === 'NOT_LEARNED')).toBe(true);
    expect(traceFilterJson.reasoning_traces.every((t) => t.status === 'NOT_LEARNED')).toBe(true);

    // 4. Autonomous Mission DAG execution with postcondition check
    const missionRes = await fetch(`${baseUrl}/api/autonomous/missions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        goal: 'คำนวณ 7 * 9',
        enableResearch: false,
        enableKnowledgeDev: false,
        enableExecution: true,
      }),
    });
    expect(missionRes.status).toBe(201);
    const missionJson = (await missionRes.json()) as {
      ok: boolean;
      mission: { status: string; external_models_used: number };
      nodes: Array<{ execution_status: string }>;
    };
    expect(missionJson.ok).toBe(true);
    expect(missionJson.mission.status).toBe('COMPLETED');
    expect(missionJson.mission.external_models_used).toBe(0);
    expect(missionJson.nodes.length).toBeGreaterThanOrEqual(3);
    expect(missionJson.nodes.every((n) => n.execution_status === 'COMPLETED')).toBe(true);

    // 4b. Verify admin/overview returns persisted reasoning_traces with task_timings for Recharts stability visualization
    const adminOverviewAfter = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: authHeaders,
    });
    expect(adminOverviewAfter.status).toBe(200);
    const adminAfterJson = (await adminOverviewAfter.json()) as {
      reasoning_traces?: Array<{ trace_json: string; latency_ms: number }>;
    };
    expect(Array.isArray(adminAfterJson.reasoning_traces)).toBe(true);
    expect(adminAfterJson.reasoning_traces!.length).toBeGreaterThanOrEqual(2);
    const firstTraceParsed = JSON.parse(adminAfterJson.reasoning_traces![0].trace_json) as {
      task_timings?: unknown[];
    };
    expect(Array.isArray(firstTraceParsed.task_timings)).toBe(true);

    // 5. Real Developer Benchmark + 7-State Capability Ledger + Baseline Persistence
    const benchRes = await fetch(`${baseUrl}/api/developer/benchmark`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ modelVersion: 'zyrquen-omega-v1' }),
    });
    expect(benchRes.status).toBe(200);
    const benchJson = (await benchRes.json()) as { ok: boolean; report: NativeBenchmarkReport };
    expect(benchJson.ok).toBe(true);
    expect(benchJson.report.environment.external_models_used).toBe(false);
    expect(benchJson.report.summary.false_positives).toBe(0);
    expect(benchJson.report.capability_ledger).toBeDefined();
    const domains = benchJson.report.capability_ledger!.domains;
    expect(Object.keys(domains)).toHaveLength(6);
    expect(domains.native_core.status).toBe('VERIFIED');
    expect(domains.planning.status).toBe('VERIFIED');
    expect(domains.memory.status).toBe('VERIFIED');
    expect(domains.learning.status).toBe('VERIFIED');
    expect(domains.autonomous_execution.status).toBe('VERIFIED');
    expect(domains.research.status).toBe('PARTIAL');
  }, 90_000);

  it('Supports member registration (สมัครสมาชิก) with password confirmation, duplicate 409 check, and user RBAC over HTTP', async () => {
    // 1. Mismatched confirmPassword rejected with 400
    const mismatchRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member-e2e@zyrquen.local',
        displayName: 'สมาชิก E2E',
        password: 'MemberPassword123!',
        confirmPassword: 'DifferentPassword123!',
      }),
    });
    expect(mismatchRes.status).toBe(400);

    // 2. Valid member registration succeeds with 201 and role='user'
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member-e2e@zyrquen.local',
        displayName: 'สมาชิก E2E',
        password: 'MemberPassword123!',
        confirmPassword: 'MemberPassword123!',
      }),
    });
    expect(regRes.status).toBe(201);
    const setCookie = regRes.headers.get('set-cookie') || '';
    expect(setCookie).toContain('zyrquen_session=');
    expect(setCookie).toContain('HttpOnly');

    const regJson = (await regRes.json()) as {
      token: string;
      user: { id: string; email: string; display_name: string; role: string };
    };
    expect(regJson.token).toBeTruthy();
    expect(regJson.user.role).toBe('user');
    expect(regJson.user.email).toBe('member-e2e@zyrquen.local');

    // 3. Duplicate registration returns 409 Conflict
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'member-e2e@zyrquen.local',
        displayName: 'สมาชิกซ้ำ',
        password: 'MemberPassword123!',
        confirmPassword: 'MemberPassword123!',
      }),
    });
    expect(dupRes.status).toBe(409);

    // 4. Member can access authenticated routes, but cannot access admin routes (403)
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${regJson.token}` },
    });
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as { user: { role: string } };
    expect(meJson.user.role).toBe('user');

    const adminOverviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${regJson.token}` },
    });
    expect(adminOverviewRes.status).toBe(403);
  }, 30_000);

  it('Exposes platform-independent /api/v1 manifest, failure-driven curriculum synthesis, and continual learning round', async () => {
    // 1. Platform-independent v1 manifest reachable unauthenticated (no secrets exposed)
    const manifestRes = await fetch(`${baseUrl}/api/v1/platform/manifest`);
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers.get('x-zyrquen-api-version')).toBe('v1');
    const manifest = (await manifestRes.json()) as {
      platform: string;
      api_version: string;
      supported_clients: string[];
      browser_dependencies_in_core: boolean;
      external_models_used: boolean;
      native_core: { status: string };
    };
    expect(manifest.platform).toBe('ZYRQUEN');
    expect(manifest.api_version).toBe('v1');
    expect(manifest.supported_clients).toContain('mobile-android');
    expect(manifest.supported_clients).toContain('desktop');
    expect(manifest.browser_dependencies_in_core).toBe(false);
    expect(manifest.external_models_used).toBe(false);
    expect(manifest.native_core.status).toBe('ready');

    // 2. Authenticate via /api/v1/auth/login (seeded admin from first test)
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'e2e-admin@zyrquen.local',
        password: 'StrongPassword123!',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginJson = (await loginRes.json()) as { token: string };
    const v1Headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginJson.token}`,
    };

    // 3. Failure-Driven Curriculum Synthesis via /api/v1/developer/curriculum/synthesize
    const currRes = await fetch(`${baseUrl}/api/v1/developer/curriculum/synthesize`, {
      method: 'POST',
      headers: v1Headers,
      body: JSON.stringify({ limit: 30 }),
    });
    expect(currRes.status).toBe(201);
    const currJson = (await currRes.json()) as {
      ok: boolean;
      leakage_checked: boolean;
      manifest_sha256: string;
    };
    expect(currJson.ok).toBe(true);
    expect(currJson.leakage_checked).toBe(true);
    expect(currJson.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);

    // 4. Continual Learning Round with Replay + L2 Anchor Consolidation via /api/v1/developer/continual-learning/run
    const clRes = await fetch(`${baseUrl}/api/v1/developer/continual-learning/run`, {
      method: 'POST',
      headers: v1Headers,
      body: JSON.stringify({
        newTrainLines: [
          'zyrquen platform independence แยกแกนปัญญาจาก frontend',
          'continual learning ใช้ experience replay และ l2 anchor',
        ],
        anchorLines: [
          'zyrquen ตรวจสอบสมการด้วย ast เสมอ',
          'zyrquen บันทึกกราฟความรู้ลง sqlite wal',
        ],
        replayRatio: 0.5,
        anchorL2Lambda: 0.04,
        epochs: 3,
        seed: 11,
      }),
    });
    expect(clRes.status).toBe(201);
    const clJson = (await clRes.json()) as {
      ok: boolean;
      continual_metrics: {
        mode: string;
        retention_rate: number;
        forgetting_loss_delta: number;
        replay_samples: number;
      };
    };
    expect(clJson.ok).toBe(true);
    expect(clJson.continual_metrics.mode).toBe('continual_replay_consolidation');
    expect(clJson.continual_metrics.replay_samples).toBeGreaterThanOrEqual(1);
    expect(clJson.continual_metrics.retention_rate).toBeGreaterThanOrEqual(0);
  }, 45_000);
});
