import type { BoardExportSnapshot } from '@kanban/shared-types';

function slugifyFileName(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'tablero-kanban'
  );
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Descarga el snapshot portátil completo del tablero en formato JSON. */
export function downloadBoardAsJson(snapshot: BoardExportSnapshot): void {
  const json = JSON.stringify(snapshot, null, 2);
  triggerDownload(json, `${slugifyFileName(snapshot.title)}.json`, 'application/json;charset=utf-8');
}

/** Convierte un snapshot de tablero en Markdown legible y lo descarga. */
export function boardSnapshotToMarkdown(snapshot: BoardExportSnapshot): string {
  const lines: string[] = [
    `# ${snapshot.title}`,
    '',
    `> Exportado el ${new Date(snapshot.exportedAt).toLocaleString('es-ES')}`,
    '',
  ];

  const commentsByCard = new Map<string, BoardExportSnapshot['comments']>();
  for (const cm of snapshot.comments) {
    const list = commentsByCard.get(cm.cardId) ?? [];
    list.push(cm);
    commentsByCard.set(cm.cardId, list);
  }

  for (const col of snapshot.columns) {
    const colCards = snapshot.cards.filter(c => c.columnId === col.id);
    lines.push(`## ${col.title} (${colCards.length})`, '');
    if (colCards.length === 0) {
      lines.push('_Sin tarjetas_', '');
      continue;
    }
    for (const card of colCards) {
      const meta: string[] = [];
      if (card.priority) meta.push(`Prioridad: ${card.priority}`);
      if (card.storyPoints != null) meta.push(`${card.storyPoints} pts`);
      if (card.assignee) meta.push(`@${card.assignee.name}`);
      if (card.dueDate) meta.push(`Vence: ${new Date(card.dueDate).toLocaleDateString('es-ES')}`);
      const metaSuffix = meta.length > 0 ? ` — _(${meta.join(' · ')})_` : '';
      lines.push(`### - ${card.title}${metaSuffix}`);
      if (card.description) {
        lines.push('', card.description);
      }
      if (card.checklist && card.checklist.length > 0) {
        lines.push('');
        for (const item of card.checklist) {
          lines.push(`- [${item.completed ? 'x' : ' '}] ${item.text}`);
        }
      }
      const cardComments = commentsByCard.get(card.id) ?? [];
      if (cardComments.length > 0) {
        lines.push('', '**Comentarios:**');
        for (const cm of cardComments) {
          lines.push(`- **${cm.authorName}**: ${cm.text}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function downloadBoardAsMarkdown(snapshot: BoardExportSnapshot): void {
  const md = boardSnapshotToMarkdown(snapshot);
  triggerDownload(md, `${slugifyFileName(snapshot.title)}.md`, 'text/markdown;charset=utf-8');
}
