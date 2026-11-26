import type { ReactNode } from 'react';

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key} className="font-semibold text-slate-100">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key} className="italic">{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 rounded bg-slate-800 text-sky-300 font-mono text-[11px]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (linkMatch) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-blue-400 break-all"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

/**
 * Renderizador seguro de Markdown a nodos React sin usar dangerouslySetInnerHTML
 * (100% compatible con CSP estricta y seguro frente a XSS).
 */
export function SafeMarkdown({ content }: { content: string }) {
  const trimmed = content.trim();
  if (!trimmed) {
    return <p className="text-xs text-slate-500 italic">Sin descripción.</p>;
  }

  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código ```
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(
        <pre key={`code-${i}`} className="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 overflow-x-auto text-[11px] font-mono text-slate-200 my-1.5">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Encabezados # ## ###
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1
        ? 'text-sm font-bold text-slate-100 mt-2 mb-1'
        : level === 2
        ? 'text-xs font-bold text-slate-100 mt-1.5 mb-1'
        : 'text-xs font-semibold text-slate-200 mt-1 mb-0.5';
      blocks.push(
        <div key={`h-${i}`} className={cls}>
          {renderInlineMarkdown(headingMatch[2], `h-${i}`)}
        </div>
      );
      i++;
      continue;
    }

    // Citas >
    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={`q-${i}`} className="border-l-2 border-primary/60 pl-2.5 text-xs text-slate-300 italic my-1">
          {renderInlineMarkdown(line.slice(2), `q-${i}`)}
        </blockquote>
      );
      i++;
      continue;
    }

    // Listas no ordenadas - o *
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 text-xs text-slate-200 my-1">
          {items.map((item, idx) => (
            <li key={`li-${i}-${idx}`}>{renderInlineMarkdown(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Listas ordenadas 1.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 text-xs text-slate-200 my-1">
          {items.map((item, idx) => (
            <li key={`oli-${i}-${idx}`}>{renderInlineMarkdown(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (!line.trim()) {
      blocks.push(<div key={`sp-${i}`} className="h-1.5" />);
      i++;
      continue;
    }

    blocks.push(
      <p key={`p-${i}`} className="text-xs text-slate-200 leading-relaxed">
        {renderInlineMarkdown(line, `p-${i}`)}
      </p>
    );
    i++;
  }

  return <div className="space-y-1">{blocks}</div>;
}
