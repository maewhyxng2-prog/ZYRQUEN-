import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.split('?')[0];
    const key = `${init?.method || 'GET'} ${path}`;
    const handler = handlers[key] || handlers[path];
    if (!handler) {
      return new Response(JSON.stringify({ error: `Unhandled route: ${key}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return handler(init);
  }) as unknown as typeof fetch;
}

describe('ZYRQUEN ประสบการณ์แอปพลิเคชันภาษาไทยเป็นหลัก', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('แสดงหน้าตั้งค่าผู้ดูแลระบบเริ่มต้นเมื่อยังไม่มีบัญชี และสมัครผู้ดูแลสำเร็จ', async () => {
    mockFetch({
      'GET /api/auth/status': () =>
        new Response(
          JSON.stringify({ initialized: false, userCount: 0, envPasscodeConfigured: false }),
          { status: 200 }
        ),
      'GET /api/health': () =>
        new Response(JSON.stringify({ ok: true, nativeCore: 'ready' }), { status: 200 }),
      'POST /api/auth/claim-admin': () =>
        new Response(
          JSON.stringify({
            token: 'mem-token-1',
            user: {
              id: 'u1',
              email: 'admin@zyrquen.local',
              display_name: 'หัวหน้าทีมวิจัย',
              role: 'admin',
              created_at: '2026-11-24T00:00:00Z',
            },
          }),
          { status: 201 }
        ),
      'GET /api/home': () =>
        new Response(
          JSON.stringify({
            recent_conversations: [],
            counts: { triples: 0, checkpoints: 0, datasets: 0, pending_approvals: 0 },
            system: {
              python_version: '3.11.2',
              platform: 'Linux',
              cpu_count: 4,
              load_1m: 0.1,
              mem_total_mb: 4096,
              mem_available_mb: 2048,
              disk_free_gb: 20,
              disk_total_gb: 50,
              sqlite_db_kb: 16,
            },
          }),
          { status: 200 }
        ),
      'GET /api/conversations': () =>
        new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    });

    render(<App />);

    expect(await screen.findByText('ตั้งค่าผู้ดูแลระบบเริ่มต้น')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('ชื่อที่แสดง'), {
      target: { value: 'หัวหน้าทีมวิจัย' },
    });
    fireEvent.change(screen.getByLabelText('อีเมล'), {
      target: { value: 'admin@zyrquen.local' },
    });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), {
      target: { value: 'supersecure99' },
    });
    fireEvent.click(screen.getByRole('button', { name: /ตั้งค่าผู้ดูแลและเข้าใช้งาน/i }));

    expect(await screen.findByText(/สวัสดี, หัวหน้าทีมวิจัย/i)).toBeInTheDocument();
    expect(screen.getByText(/แกนสมองภายในพร้อมใช้งาน/i)).toBeInTheDocument();
  });

  it('นำทาง หน้าหลัก -> เวิร์กสเปซ -> ตั้งค่า -> ออกจากระบบ, รองรับประวัติเบราว์เซอร์ และตรวจสอบสิทธิ์ RBAC', async () => {
    mockFetch({
      'GET /api/auth/status': () =>
        new Response(
          JSON.stringify({ initialized: true, userCount: 2, envPasscodeConfigured: false }),
          { status: 200 }
        ),
      'GET /api/health': () =>
        new Response(JSON.stringify({ ok: true, nativeCore: 'ready' }), { status: 200 }),
      'POST /api/auth/login': () =>
        new Response(
          JSON.stringify({
            token: 'user-token',
            user: {
              id: 'u2',
              email: 'member@zyrquen.local',
              display_name: 'สมาชิกทดสอบ',
              role: 'user',
              created_at: '2026-11-24T00:00:00Z',
            },
          }),
          { status: 200 }
        ),
      'GET /api/home': () =>
        new Response(
          JSON.stringify({
            recent_conversations: [],
            counts: { triples: 1, checkpoints: 0, datasets: 0, pending_approvals: 0 },
            system: { python_version: '3.11.2' },
          }),
          { status: 200 }
        ),
      'GET /api/conversations': () =>
        new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
      'POST /api/conversations': () =>
        new Response(
          JSON.stringify({
            conversation: {
              id: 'c1',
              title: 'คำนวณ (2^12 - 96) / 16',
              mode: 'math',
              updated_at: '2026-11-24T00:00:00Z',
              message_count: 0,
            },
          }),
          { status: 201 }
        ),
      'GET /api/conversations/c1': () =>
        new Response(
          JSON.stringify({
            conversation: {
              id: 'c1',
              title: 'คำนวณ (2^12 - 96) / 16',
              mode: 'math',
              updated_at: '2026-11-24T00:00:00Z',
              message_count: 2,
            },
            messages: [],
          }),
          { status: 200 }
        ),
      'GET /api/conversations/c1/summary': () =>
        new Response(
          JSON.stringify({
            ok: true,
            summary: {
              bullets: [
                'คำนวณ AST ยืนยันผล: `(2**12 - 96) / 16` = `250`',
                'หัวข้อหลักที่สนทนา: คำนวณ',
              ],
              metrics: { total_messages: 2, verified_count: 1, not_learned_count: 0 },
            },
          }),
          { status: 200 }
        ),
      'POST /api/conversations/c1/stream': (() => {
        let msgSeq = 0;
        return (init?: RequestInit) => {
          msgSeq += 1;
          const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          const meta = (body.metadata || {}) as Record<string, unknown>;
          (globalThis as unknown as { __lastStreamMeta?: Record<string, unknown> }).__lastStreamMeta = meta;
          return new Response(
            JSON.stringify({
              title: 'คำนวณ (2^12 - 96) / 16',
              user_message: {
                id: `m-u-${msgSeq}`,
                conversation_id: 'c1',
                role: 'user',
                content: 'คำนวณ (2^12 - 96) / 16',
                mode: 'math',
                trace_json: null,
                status: 'USER',
                created_at: '2026-11-24T00:00:01Z',
              },
              assistant_message: {
                id: `m-a-${msgSeq}`,
                conversation_id: 'c1',
                role: 'assistant',
                content: '**ผลลัพธ์:** `250`',
                mode: 'math',
                trace_json: JSON.stringify({
                  engine_path: ['math_ast'],
                  model_version: meta.modelVersion || 'zyrquen-omega-v1',
                  latency_ms: 4.2,
                  external_models_used: false,
                }),
                status: 'VERIFIED',
                created_at: '2026-11-24T00:00:02Z',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        };
      })(),
      'GET /api/developer/overview': (() => {
        return () =>
          new Response(
            JSON.stringify({
              keys: [],
              datasets: [
                {
                  id: 'ds-1',
                  name: 'zyrquen-core-corpus',
                  manifest_hash: 'abcdef1234567890',
                  total_records: 8,
                  train_count: 5,
                  val_count: 1,
                  test_count: 2,
                  leakage_detected: 0,
                  status: 'READY',
                  created_at: '2026-11-24T00:00:00Z',
                },
              ],
              checkpoints: [],
              evaluations: (globalThis as unknown as { __mockEvals?: Array<Record<string, unknown>> }).__mockEvals || [],
              usage: { total_requests: 5, avg_latency_ms: 12.4, daily_quota: 1000, recent: [] },
            }),
            { status: 200 }
          );
      })(),
      'POST /api/workflows/native_training/run': () =>
        new Response(
          JSON.stringify({
            ok: true,
            run: {
              id: 'r-train-1',
              group_id: 'native_training',
              status: 'PENDING_APPROVAL',
              requires_approval: 1,
              summary: 'Approval Gate active: ฝึกโมเดลภายใน requires Admin authorization.',
            },
          }),
          { status: 201 }
        ),
      'POST /api/developer/evaluate': () => {
        const evalRecord = {
          id: 'ev-1',
          checkpoint_version: null,
          suite_name: 'ZYRQUEN Scientific Benchmark v1',
          overall_status: 'PARTIAL',
          math_score: 1.0,
          knowledge_score: 0.0,
          planning_score: 1.0,
          test_accuracy: null,
          perplexity: null,
          baseline_delta_json: null,
          created_at: '2026-11-24T00:00:00Z',
        };
        (globalThis as unknown as { __mockEvals?: Array<Record<string, unknown>> }).__mockEvals = [evalRecord];
        return new Response(
          JSON.stringify({ ok: true, evaluation: evalRecord }),
          { status: 201 }
        );
      },
      'GET /api/developer/tools': () =>
        new Response(
          JSON.stringify({
            tools: [
              {
                id: 'web_search',
                name: 'ค้นหาเว็บสาธารณะ (Web Search Tool)',
                category: 'web',
                description: 'ค้นหาสาธารณะ',
                endpoint_allowlist_json: '["en.wikipedia.org"]',
                permission_mode: 'approval_required',
                enabled: 1,
                quota_daily: 50,
                calls_today: 0,
                last_reset_date: '2026-11-24',
                updated_at: '2026-11-24T00:00:00Z',
              },
              {
                id: 'calc_ast',
                name: 'คำนวณ AST / สมการ / สถิติ (Compute Tool)',
                category: 'compute',
                description: 'คำนวณ AST ภายใน',
                endpoint_allowlist_json: '[]',
                permission_mode: 'auto',
                enabled: 1,
                quota_daily: 200,
                calls_today: 1,
                last_reset_date: '2026-11-24',
                updated_at: '2026-11-24T00:00:00Z',
              },
            ],
            invocations: [],
            workspace_files: [],
          }),
          { status: 200 }
        ),
      'POST /api/developer/tools/calc_ast/invoke': () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: 'COMPLETED',
            analysis: {
              summary: 'ZYRQUEN Native Compute ยืนยันผลลัพธ์จากเครื่องมือ AST ภายในเรียบร้อยแล้ว',
            },
          }),
          { status: 201 }
        ),
      'POST /api/auth/logout': () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    });

    (globalThis as unknown as { __mockEvals?: Array<Record<string, unknown>> }).__mockEvals = [];

    render(<App />);

    const emailInput = await screen.findByLabelText('อีเมล');
    fireEvent.change(emailInput, { target: { value: 'member@zyrquen.local' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'password123' } });
    const signInButtons = screen.getAllByRole('button', { name: 'เข้าสู่ระบบ' });
    fireEvent.click(signInButtons[signInButtons.length - 1]);

    expect(await screen.findByText(/สวัสดี, สมาชิกทดสอบ/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'คำนวณ AST เชิงสัญลักษณ์' }));
    expect(await screen.findByText('250')).toBeInTheDocument();
    expect(window.location.search).toContain('view=workspace');

    const variantSelect = screen.getByLabelText('เลือกรุ่นโมเดล (Model Variant)');
    fireEvent.change(variantSelect, { target: { value: 'zyrquen-ast-pro' } });

    const composer = screen.getByLabelText('ช่องพิมพ์ข้อความ');
    fireEvent.change(composer, { target: { value: 'คำนวณ 10 + 15' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });
    await waitFor(() => {
      expect(screen.getAllByText('250').length).toBeGreaterThan(0);
    });
    expect(
      (globalThis as unknown as { __lastStreamMeta?: Record<string, unknown> }).__lastStreamMeta?.modelVersion
    ).toBe('zyrquen-ast-pro');

    // Smart Summary collapsible panel
    fireEvent.click(screen.getByRole('button', { name: /สรุปสำคัญ/i }));
    expect(await screen.findByText(/Smart Summary/i)).toBeInTheDocument();
    expect(await screen.findByText(/คำนวณ AST ยืนยันผล/i)).toBeInTheDocument();

    // Ctrl+K Command Palette shortcut + Fuse.js typo tolerance
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: /Command Palette/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาคำสั่งด่วน'), { target: { value: 'Accont' } });
    fireEvent.click(await screen.findByRole('button', { name: /ไปที่ ตั้งค่าบัญชีผู้ใช้/i }));
    expect(await screen.findByText('โปรไฟล์และเซสชัน')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'ผู้ดูแลระบบ' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'นักพัฒนา' }));
    expect(await screen.findByText('จัดการ API Keys')).toBeInTheDocument();
    expect(await screen.findByText('12.4 ms')).toBeInTheDocument();
    expect(await screen.findByText('zyrquen-core-corpus')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอฝึก (Gate)' }));
    expect(await screen.findByText(/เข้า Approval Gate แล้ว/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ประเมินผลเทียบ Baseline' }));
    expect(await screen.findByText(/ผลประเมินล่าสุด \(PARTIAL\)/i)).toBeInTheDocument();

    // External Tool Registry & Governed Invocation inside Developer Settings
    expect(await screen.findByText('Tool Registry & โควตาเครื่องมือภายนอก')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('เลือกเครื่องมือ'), { target: { value: 'calc_ast' } });
    fireEvent.change(screen.getByPlaceholderText('แก้สมการ: 3x + 7 = 22'), {
      target: { value: 'แก้สมการ: 3x + 7 = 22' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'เรียกเครื่องมือ' }));
    expect(
      await screen.findByText(/ZYRQUEN Native Compute ยืนยันผลลัพธ์/i)
    ).toBeInTheDocument();

    // Alt+N global shortcut starts a fresh Workspace conversation
    fireEvent.keyDown(window, { key: 'n', altKey: true });
    expect(await screen.findByText('เวิร์กสเปซ ZYRQUEN Ω∞')).toBeInTheDocument();

    window.history.replaceState({}, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText(/สวัสดี, สมาชิกทดสอบ/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'ตั้งค่า' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'ออกจากระบบ' }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'เข้าสู่ระบบ' }).length).toBeGreaterThan(0);
    });
  });

  it('ซ่อนแถบนำทางล่างบนมือถือใน Workspace, เปิดประวัติบทสนทนา และรันเวิร์กโฟลว์ในหน้าความจำได้', async () => {
    mockFetch({
      'GET /api/auth/status': () =>
        new Response(
          JSON.stringify({ initialized: true, userCount: 1, envPasscodeConfigured: false }),
          { status: 200 }
        ),
      'GET /api/health': () =>
        new Response(JSON.stringify({ ok: true, nativeCore: 'ready' }), { status: 200 }),
      'POST /api/auth/login': () =>
        new Response(
          JSON.stringify({
            token: 'admin-token',
            user: {
              id: 'u1',
              email: 'admin@zyrquen.local',
              display_name: 'ผู้ดูแลหลัก',
              role: 'admin',
              created_at: '2026-11-24T00:00:00Z',
            },
          }),
          { status: 200 }
        ),
      'GET /api/home': () =>
        new Response(
          JSON.stringify({
            recent_conversations: [
              {
                id: 'c-prev',
                title: 'เซสชันคณิตศาสตร์ก่อนหน้า',
                mode: 'math',
                updated_at: '2026-11-24T00:00:00Z',
                message_count: 2,
              },
            ],
            counts: { triples: 2, checkpoints: 1, datasets: 1, pending_approvals: 0 },
            system: { python_version: '3.11.2' },
          }),
          { status: 200 }
        ),
      'GET /api/conversations': () =>
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: 'c-prev',
                title: 'เซสชันคณิตศาสตร์ก่อนหน้า',
                mode: 'math',
                updated_at: '2026-11-24T00:00:00Z',
                message_count: 2,
              },
            ],
          }),
          { status: 200 }
        ),
      'GET /api/knowledge': () =>
        new Response(
          JSON.stringify({
            triples: [
              {
                id: 't1',
                subject: 'ZYRQUEN',
                relation: 'ใช้งาน',
                object: 'Python Native Core',
                source: 'test',
                confidence: 1,
                created_by: 'u1',
                created_at: '2026-11-24T00:00:00Z',
              },
            ],
          }),
          { status: 200 }
        ),
      'GET /api/workflows': () =>
        new Response(
          JSON.stringify({
            groups: [
              {
                id: 'system_ops',
                name: 'ปฏิบัติการระบบ (System Operations)',
                description: 'ตรวจสุขภาพระบบ',
                requires_approval: false,
                stages: ['health_probe'],
              },
              {
                id: 'native_training',
                name: 'ฝึกโมเดลภายใน (Native Training)',
                description: 'ฝึก Checkpoint รุ่นใหม่',
                requires_approval: true,
                stages: ['approval_gate'],
              },
            ],
            runs: [],
          }),
          { status: 200 }
        ),
      'POST /api/workflows/system_ops/run': () =>
        new Response(
          JSON.stringify({
            run: {
              id: 'r1',
              group_id: 'system_ops',
              status: 'COMPLETED',
              requires_approval: 0,
              triggered_by: 'u1',
              approved_by: null,
              summary: 'System Operations verified.',
              stages_json: JSON.stringify([{ stage: 'health_probe', status: 'PASS', detail: 'OK' }]),
              created_at: '2026-11-24T00:00:00Z',
              updated_at: '2026-11-24T00:00:00Z',
            },
          }),
          { status: 201 }
        ),
    });

    render(<App />);
    const emailInput = await screen.findByLabelText('อีเมล');
    fireEvent.change(emailInput, { target: { value: 'admin@zyrquen.local' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'password123' } });
    const signInButtons = screen.getAllByRole('button', { name: 'เข้าสู่ระบบ' });
    fireEvent.click(signInButtons[signInButtons.length - 1]);

    expect(await screen.findByText('เซสชันคณิตศาสตร์ก่อนหน้า')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'แถบนำทางมือถือ' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'เวิร์กสเปซ' })[0]);
    expect(await screen.findByLabelText('ช่องพิมพ์ข้อความ')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'แถบนำทางมือถือ' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'เปิดประวัติบทสนทนา' }));
    expect(await screen.findByRole('dialog', { name: 'ประวัติบทสนทนา' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดประวัติ' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'ความจำ' })[0]);
    expect(await screen.findByText('ความจำและระบบเวิร์กโฟลว์ภายใน')).toBeInTheDocument();

    // Global fuzzy search with Fuse.js queries across Knowledge Fragments & Workflow Definitions simultaneously
    const globalSearch = screen.getByLabelText('ค้นหากราฟความรู้และเวิร์กโฟลว์');
    fireEvent.change(globalSearch, { target: { value: 'System Operatons' } });
    expect(await screen.findByText('ปฏิบัติการระบบ (System Operations)')).toBeInTheDocument();
    expect(screen.queryByText('ฝึกโมเดลภายใน (Native Training)')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'เริ่มรันเวิร์กโฟลว์' }));
    expect(await screen.findByText('System Operations verified.')).toBeInTheDocument();

    fireEvent.change(globalSearch, { target: { value: 'Pythn' } });
    expect(await screen.findByText('Python Native Core')).toBeInTheDocument();
  });

  it('รับเสียงผ่าน SpeechRecognition API ลงในช่องข้อความ และบังคับใช้งานแบบเชื่อมต่ออินเทอร์เน็ตเท่านั้น', async () => {
    class MockSpeechRecognition {
      lang = 'th-TH';
      interimResults = false;
      continuous = false;
      onresult: ((ev: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        expect(this.interimResults).toBe(true);
        expect(this.continuous).toBe(true);
        // First emit interim partial spoken text
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: false, 0: { transcript: 'คำนวณ 25' } }],
        });
        // Then commit final transcript seamlessly without duplicating interim text
        this.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: 'คำนวณ 25 * 4' } }],
        });
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }

    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = MockSpeechRecognition;

    mockFetch({
      'GET /api/auth/status': () =>
        new Response(
          JSON.stringify({ initialized: true, userCount: 1, envPasscodeConfigured: false }),
          { status: 200 }
        ),
      'GET /api/health': () =>
        new Response(JSON.stringify({ ok: true, nativeCore: 'ready' }), { status: 200 }),
      'POST /api/auth/login': () =>
        new Response(
          JSON.stringify({
            token: 'voice-token',
            user: {
              id: 'u1',
              email: 'admin@zyrquen.local',
              display_name: 'ผู้ดูแลเสียง',
              role: 'admin',
              created_at: '2026-11-24T00:00:00Z',
            },
          }),
          { status: 200 }
        ),
      'GET /api/home': () =>
        new Response(
          JSON.stringify({
            recent_conversations: [],
            counts: { triples: 0, checkpoints: 0, datasets: 0, pending_approvals: 0 },
            system: { python_version: '3.11.2' },
          }),
          { status: 200 }
        ),
      'GET /api/conversations': () =>
        new Response(JSON.stringify({ conversations: [] }), { status: 200 }),
    });

    render(<App />);
    const emailInput = await screen.findByLabelText('อีเมล');
    fireEvent.change(emailInput, { target: { value: 'admin@zyrquen.local' } });
    fireEvent.change(screen.getByLabelText('รหัสผ่าน'), { target: { value: 'password123' } });
    const signInButtons = screen.getAllByRole('button', { name: 'เข้าสู่ระบบ' });
    fireEvent.click(signInButtons[signInButtons.length - 1]);

    expect(await screen.findByText(/สวัสดี, ผู้ดูแลเสียง/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'เวิร์กสเปซ' })[0]);

    const micBtn = await screen.findByRole('button', { name: /พิมพ์ด้วยเสียง/i });
    fireEvent.click(micBtn);

    const textarea = screen.getByLabelText('ช่องพิมพ์ข้อความ') as HTMLTextAreaElement;
    expect(textarea.value).toContain('คำนวณ 25 * 4');

    // Enforce online-only connectivity
    fireEvent(window, new Event('offline'));
    expect(await screen.findByText('ต้องเชื่อมต่ออินเทอร์เน็ตเท่านั้น')).toBeInTheDocument();
    fireEvent(window, new Event('online'));
    expect(await screen.findByLabelText('ช่องพิมพ์ข้อความ')).toBeInTheDocument();

    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it('แสดงกล่องหลักฐานวิเคราะห์จาก Native Core (>) และรายการใน SafeMessageText อย่างปลอดภัย', async () => {
    const { SafeMessageText } = await import('../components/SafeMessageText');
    render(
      <SafeMessageText
        content={
          '**ผลสังเคราะห์หลักฐานโดย ZYRQUEN Native Core** (`web_search` · ระดับความน่าเชื่อถือ: `CORROBORATED_MULTI_SOURCE`)\n\n' +
          '> [CORROBORATED_MULTI_SOURCE] Native Core ประเมินหลักฐานจาก 2 แหล่ง\n\n' +
          '- คำสำคัญที่สอดคล้องข้ามแหล่งข้อมูล: `sqlite, database`'
        }
      />
    );

    expect(
      screen.getByText(/ผลสังเคราะห์หลักฐานโดย ZYRQUEN Native Core/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/\[CORROBORATED_MULTI_SOURCE\] Native Core ประเมินหลักฐานจาก 2 แหล่ง/)
    ).toBeInTheDocument();
    expect(screen.getByText('sqlite, database')).toBeInTheDocument();
  });

  it('ตรวจสอบ ExternalToolAdapter (validate/run/audit), ToolRegistry P5 Gate และตัวบอกสถานะเครื่องมือใน WorkspaceView', async () => {
    const { externalToolAdapter } = await import('../lib/tools');
    const { ToolRegistry } = await import('../components/ToolRegistry');
    const { WorkspaceView } = await import('../components/WorkspaceView');

    // 1. Adapter validation blocks insecure HTTP & external AI hosts
    const badHttp = externalToolAdapter.validate('doc_fetch', { url: 'http://en.wikipedia.org/wiki/SQLite' });
    expect(badHttp.ok).toBe(false);
    const badLlm = externalToolAdapter.validate('doc_fetch', { url: 'https://api.openai.com/v1/models' });
    expect(badLlm.ok).toBe(false);
    const badPath = externalToolAdapter.validate('workspace_file_read', { action: 'read', filename: '../secret.txt' });
    expect(badPath.ok).toBe(false);

    // 2. Adapter run() validates, invokes backend, and records audit entries
    const decideCalls: string[] = [];
    mockFetch({
      'POST /api/developer/tools/calc_ast/invoke': () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: 'COMPLETED',
            invocation: {
              id: 'inv-99',
              tool_id: 'calc_ast',
              conversation_id: null,
              user_id: 'u2',
              status: 'COMPLETED',
              input_json: '{"expression":"2+3"}',
              output_json: '{"result":5}',
              analysis_summary: 'ผลคำนวณ AST = 5',
              approved_by: null,
              latency_ms: 1.5,
              created_at: '2026-11-24T00:00:00Z',
            },
            analysis: { trust_grade: 'INTERNAL_DETERMINISTIC', summary: 'ผลคำนวณ AST = 5' },
          }),
          { status: 201 }
        ),
      'POST /api/admin/tool-invocations/inv-gate-1/decide': () => {
        decideCalls.push('inv-gate-1');
        return new Response(JSON.stringify({ ok: true, status: 'COMPLETED' }), { status: 200 });
      },
    });

    const runRes = await externalToolAdapter.run('calc_ast', { expression: '2 + 3' }, 'tok-1');
    expect(runRes.ok).toBe(true);
    expect(runRes.status).toBe('COMPLETED');
    const entries = externalToolAdapter.audit({
      toolId: 'calc_ast',
      action: 'TEST_AUDIT_CHECK',
      outcome: 'COMPLETED',
      timestamp: '2026-11-24T00:00:00Z',
    });
    expect(entries.some((e) => e.action === 'TEST_AUDIT_CHECK')).toBe(true);

    // 3. ToolRegistry Admin P5 Gate renders & approves
    const onRefresh = vi.fn();
    render(
      <ToolRegistry
        token="admin-tok"
        userRole="admin"
        mode="admin"
        pendingInvocations={[
          {
            id: 'inv-gate-1',
            tool_id: 'web_search',
            conversation_id: null,
            user_id: 'u2',
            status: 'PENDING_APPROVAL',
            input_json: '{"query":"SQLite"}',
            output_json: null,
            analysis_summary: null,
            approved_by: null,
            latency_ms: 0,
            created_at: '2026-11-24T00:00:00Z',
          },
        ]}
        adminTools={[]}
        onRefresh={onRefresh}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'อนุมัติเครื่องมือ' }));
    await waitFor(() => {
      expect(decideCalls).toEqual(['inv-gate-1']);
    });

    // 4. WorkspaceView shows subtle tool status indicator while awaiting tool response
    let resolveSend!: () => void;
    const sendPromise = new Promise<void>((r) => {
      resolveSend = r;
    });
    const { rerender } = render(
      <WorkspaceView
        token="tok-1"
        conversations={[]}
        activeConversationId="c1"
        activeTitle="ทดสอบ"
        messages={[]}
        loadingThread={false}
        sending={false}
        error={null}
        autoExpandTrace={false}
        defaultMode="auto"
        onSelectConversation={vi.fn()}
        onNewConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onSendMessage={vi.fn(() => sendPromise)}
      />
    );

    const box = screen.getByLabelText('ช่องพิมพ์ข้อความ');
    fireEvent.change(box, { target: { value: 'ค้นคว้า: SQLite' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });

    rerender(
      <WorkspaceView
        token="tok-1"
        conversations={[]}
        activeConversationId="c1"
        activeTitle="ทดสอบ"
        messages={[]}
        loadingThread={false}
        sending={true}
        error={null}
        autoExpandTrace={false}
        defaultMode="auto"
        onSelectConversation={vi.fn()}
        onNewConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onSendMessage={vi.fn(() => sendPromise)}
      />
    );

    expect(await screen.findByRole('status')).toHaveTextContent('กำลังสืบค้นข้อมูลและตรวจสอบหลักฐาน...');
    await act(async () => {
      resolveSend();
    });

    // 5. ToolRegistry enforces role & system policy restrictions in developer mode
    render(
      <ToolRegistry
        token="user-tok"
        userRole="user"
        mode="developer"
        toolsData={{
          tools: [
            {
              id: 'web_search',
              name: 'ค้นหาเว็บสาธารณะ',
              category: 'web',
              description: 'ปิดโดยผู้ดูแล',
              endpoint_allowlist_json: '[]',
              permission_mode: 'disabled',
              enabled: 0,
              quota_daily: 50,
              calls_today: 0,
              last_reset_date: '2026-11-24',
              updated_at: '2026-11-24T00:00:00Z',
            },
          ],
          invocations: [],
          workspace_files: [],
        }}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'ถูกจำกัดสิทธิ์' })).toBeDisabled();
  });
});
