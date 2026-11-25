const INTERNAL_DIAGNOSTIC_KEYS = new Set([
  'cognitive_pipeline',
  'inference_gap',
  'epistemic_state',
  'cognitive_state',
  'model_weights_changed',
  'pipeline_trace',
  'task_timings',
  'bottleneck_task',
  'engine_path',
  'attempted_inferences',
  'external_models_used',
]);

const SENSITIVE_METADATA_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
  'password_hash',
  'secret',
  'secret_hash',
  'plaintextKey',
  'api_key',
  'apiKey',
  'authorization',
  'cookie',
  'set-cookie',
  'private_key',
  'session_id',
  'internal_reasoning',
  'hidden_metadata',
]);

const INTERNAL_LINE_PREFIX_RE =
  /^\s*(?:cognitive_pipeline|inference_gap|epistemic_state|model_weights_changed|pipeline_trace|internal_diagnostics|retrieval_diagnostics|internal_reasoning|hidden_metadata|password_hash|secret_hash|access_token|refresh_token)\s*[:=]/i;

const INTERNAL_DIAGNOSTIC_LINE_RES = [
  /^\s*Knowledge Graph contains 0 records\b/i,
  /^\s*No trained checkpoint\b/i,
  /^\s*AST parsing failure\b/i,
];

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_METADATA_KEYS.has(k) || SENSITIVE_METADATA_KEYS.has(k.toLowerCase())) {
        continue;
      }
      out[k] = redactSensitiveData(v, depth + 1);
    }
    return out;
  }
  return value;
}

function extractResponseFromDiagnosticJson(raw: string): string | null {
  let candidate = raw.trim();
  const fenced = candidate.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) {
    candidate = fenced[1].trim();
  }
  if (!(candidate.startsWith('{') && candidate.endsWith('}'))) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const hasInternalKey = Object.keys(parsed).some((k) => INTERNAL_DIAGNOSTIC_KEYS.has(k));
      if (hasInternalKey) {
        for (const candidateKey of ['response', 'content', 'message', 'text', 'answer']) {
          const val = parsed[candidateKey];
          if (typeof val === 'string' && val.trim()) {
            return sanitizeAssistantDisplayContent(val);
          }
        }
        return 'พร้อมให้บริการครับ หากมีคำถามหรือเรื่องที่ต้องการให้ช่วย สามารถพิมพ์บอกได้เลยครับ';
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function sanitizeAssistantDisplayContent(rawContent: string): string {
  const input = String(rawContent ?? '');
  const trimmed = input.trim();
  if (!trimmed) return '';

  const unwrapped = extractResponseFromDiagnosticJson(trimmed);
  if (unwrapped !== null) {
    return unwrapped;
  }

  const lines = input.split('\n');
  const kept: string[] = [];
  let inCodeBlock = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      kept.push(line);
      continue;
    }
    if (!inCodeBlock) {
      if (
        INTERNAL_LINE_PREFIX_RE.test(line) ||
        INTERNAL_DIAGNOSTIC_LINE_RES.some((re) => re.test(line))
      ) {
        continue;
      }
      const lineTrim = line.trim();
      if (lineTrim.startsWith('{') && lineTrim.endsWith('}')) {
        const extracted = extractResponseFromDiagnosticJson(lineTrim);
        if (extracted !== null) {
          kept.push(extracted);
          continue;
        }
      }
    }
    kept.push(line);
  }

  return kept.join('\n').trim() || input.trim();
}

export function serializeTableToTsv(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): string {
  const cleanCell = (val: string | number | boolean | null | undefined): string => {
    if (val === null || val === undefined) return '';
    return String(val)
      .replace(/\r?\n+/g, ' ')
      .replace(/\t+/g, ' ')
      .trim();
  };
  const headerLine = headers.map(cleanCell).join('\t');
  const bodyLines = rows.map((row) => row.map(cleanCell).join('\t'));
  return [headerLine, ...bodyLines].filter((line) => line.length > 0).join('\n');
}

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = inner.split('|').map((c) => c.trim());
  return cells.length >= 2 ? cells : null;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  if (!cells) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

export function parseMarkdownPipeTable(
  lines: string[],
  startIndex: number
): { headers: string[]; rows: string[][]; nextIndex: number } | null {
  if (startIndex + 1 >= lines.length) return null;
  const headers = splitMarkdownTableRow(lines[startIndex]);
  if (!headers || !isMarkdownTableSeparator(lines[startIndex + 1])) return null;
  const rows: string[][] = [];
  let idx = startIndex + 2;
  while (idx < lines.length) {
    const row = splitMarkdownTableRow(lines[idx]);
    if (!row) break;
    const normalized = headers.map((_, colIdx) => row[colIdx] ?? '');
    rows.push(normalized);
    idx += 1;
  }
  return { headers, rows, nextIndex: idx };
}

function stripInlineMarkdown(line: string): string {
  let out = line;
  out = out.replace(/^(\s*)>\s?/, '$1');
  out = out.replace(/^(\s*)#{1,6}\s+/, '$1');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/(^|[^\w])\*([^*\n]+)\*([^\w]|$)/g, '$1$2$3');
  return out;
}

export function toPlainAssistantCopyText(rawContent: string): string {
  const clean = sanitizeAssistantDisplayContent(rawContent);
  if (!clean) return '';

  const lines = clean.split('\n');
  const outLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Preserve fenced code block contents verbatim (including indentation and # comments)
    if (/^\s*```[a-zA-Z0-9_-]*\s*$/.test(line)) {
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^\s*```\s*$/.test(lines[i])) {
        i += 1;
      }
      outLines.push(...codeLines);
      continue;
    }

    // Convert Markdown pipe tables to tab-separated format
    const table = parseMarkdownPipeTable(lines, i);
    if (table) {
      outLines.push(
        serializeTableToTsv(
          table.headers.map(stripInlineMarkdown),
          table.rows.map((r) => r.map(stripInlineMarkdown))
        )
      );
      i = table.nextIndex;
      continue;
    }

    outLines.push(stripInlineMarkdown(line));
    i += 1;
  }

  return outLines
    .filter((line, idx, arr) => !(line === '' && (idx === 0 || idx === arr.length - 1)))
    .join('\n');
}

export async function copyTextToClipboard(
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!text) {
    return { ok: false, error: 'ไม่มีข้อความให้คัดลอก' };
  }

  // 1. Primary modern Clipboard API
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // Fall through to execCommand fallback (e.g. Android WebView / restricted context)
    }
  }

  // 2. Fallback off-screen textarea selection for Android/legacy browsers
  if (typeof document !== 'undefined' && document.body) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const copied =
        typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
      if (copied) {
        return { ok: true };
      }
    } catch {
      // Handled below
    } finally {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea);
      }
    }
  }

  return { ok: false, error: 'คัดลอกไม่สำเร็จ (คลิปบอร์ดถูกจำกัดสิทธิ์)' };
}
