import React from 'react';
import {
  copyTextToClipboard,
  parseMarkdownPipeTable,
  redactSensitiveData,
  sanitizeAssistantDisplayContent,
  serializeTableToTsv,
  toPlainAssistantCopyText,
} from '../lib/clipboard';
import { CopyButton } from './CopyButton';

export {
  copyTextToClipboard,
  redactSensitiveData,
  sanitizeAssistantDisplayContent,
  serializeTableToTsv,
  toPlainAssistantCopyText,
};

function renderInlineSegments(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[var(--color-text)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--color-accent)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic text-[var(--color-text-secondary)]">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

type MessageBlock =
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'spacer' }
  | { kind: 'blockquote'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string };

function parseMessageBlocks(sanitized: string): MessageBlock[] {
  const lines = sanitized.split('\n');
  const blocks: MessageBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*```([a-zA-Z0-9_-]*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'code';
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && /^\s*```\s*$/.test(lines[i])) {
        i += 1;
      }
      blocks.push({ kind: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    const table = parseMarkdownPipeTable(lines, i);
    if (table) {
      blocks.push({ kind: 'table', headers: table.headers, rows: table.rows });
      i = table.nextIndex;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push({ kind: 'spacer' });
    } else if (trimmed.startsWith('> ')) {
      blocks.push({ kind: 'blockquote', text: trimmed.slice(2) });
    } else if (trimmed.startsWith('- ')) {
      blocks.push({ kind: 'bullet', text: trimmed.slice(2) });
    } else if (/^#{1,6}\s+/.test(trimmed)) {
      blocks.push({ kind: 'heading', text: trimmed.replace(/^#{1,6}\s+/, '') });
    } else {
      blocks.push({ kind: 'paragraph', text: line });
    }
    i += 1;
  }

  return blocks;
}

export const SafeMessageText = React.memo(function SafeMessageText({ content }: { content: string }) {
  const sanitized = sanitizeAssistantDisplayContent(content);
  const blocks = parseMessageBlocks(sanitized);

  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-[var(--color-text)]">
      {blocks.map((block, i) => {
        if (block.kind === 'spacer') {
          return <div key={i} className="h-1" />;
        }
        if (block.kind === 'code') {
          return (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]/60 px-3 py-1.5">
                <span className="font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">
                  {block.lang}
                </span>
                <CopyButton
                  getText={() => block.code}
                  label="คัดลอกโค้ด"
                  ariaLabel="คัดลอกโค้ด"
                  title="คัดลอกโค้ดทั้งหมดแบบไม่ติดเลขบรรทัด"
                  size="xs"
                />
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-[var(--color-text)]">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        if (block.kind === 'table') {
          return (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)]/60 px-3 py-1.5">
                <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
                  ตารางข้อมูล ({block.rows.length} แถว)
                </span>
                <CopyButton
                  getText={() => serializeTableToTsv(block.headers, block.rows)}
                  label="คัดลอกตาราง"
                  ariaLabel="คัดลอกตาราง"
                  title="คัดลอกตารางเป็นรูปแบบคั่นด้วยแท็บ (TSV)"
                  size="xs"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[var(--color-text-secondary)]">
                      {block.headers.map((h, colIdx) => (
                        <th key={colIdx} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {renderInlineSegments(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {block.rows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {row.map((cell, colIdx) => (
                          <td key={colIdx} className="px-3 py-2 text-[var(--color-text)]">
                            {renderInlineSegments(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }
        if (block.kind === 'blockquote') {
          return (
            <div
              key={i}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs leading-relaxed text-[var(--color-accent)]"
            >
              {renderInlineSegments(block.text)}
            </div>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <div key={i} className="flex items-start gap-2.5 pl-1">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">{renderInlineSegments(block.text)}</span>
            </div>
          );
        }
        if (block.kind === 'heading') {
          return (
            <p key={i} className="font-semibold text-[var(--color-text)]">
              {renderInlineSegments(block.text)}
            </p>
          );
        }
        return <p key={i}>{renderInlineSegments(block.text)}</p>;
      })}
    </div>
  );
});
