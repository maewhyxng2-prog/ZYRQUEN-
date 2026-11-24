import React from 'react';

function renderInlineSegments(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic text-slate-300">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function SafeMessageText({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-slate-200">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={i} className="h-1" />;
        }
        if (trimmed.startsWith('> ')) {
          return (
            <div
              key={i}
              className="rounded-r-xl border-l-2 border-cyan-500/60 bg-[#070C18]/80 px-3 py-2 text-xs leading-relaxed text-cyan-200"
            >
              {renderInlineSegments(trimmed.slice(2))}
            </div>
          );
        }
        if (trimmed.startsWith('- ')) {
          return (
            <div key={i} className="flex items-start gap-2.5 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden="true" />
              <span className="min-w-0 flex-1">{renderInlineSegments(trimmed.slice(2))}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineSegments(line)}</p>;
      })}
    </div>
  );
}
