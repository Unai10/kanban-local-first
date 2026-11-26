/** Identificadores de plantillas predefinidas al crear un tablero. */
export type BoardTemplateId = 'classic' | 'agile' | 'bugs' | 'blank';

export interface BoardTemplateColumn {
  id: string;
  title: string;
  color?: string;
}

export interface BoardTemplate {
  id: BoardTemplateId;
  name: string;
  description: string;
  columns: BoardTemplateColumn[];
}

export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  {
    id: 'classic',
    name: 'Kanban Clásico',
    description: 'Flujo simple de 3 columnas para cualquier proyecto.',
    columns: [
      { id: 'col-todo', title: 'Por Hacer' },
      { id: 'col-progress', title: 'En Progreso' },
      { id: 'col-done', title: 'Terminado' },
    ],
  },
  {
    id: 'agile',
    name: 'Sprint Ágil',
    description: 'Ideal para equipos de desarrollo con revisión de código.',
    columns: [
      { id: 'col-backlog', title: 'Backlog' },
      { id: 'col-todo', title: 'Por Hacer' },
      { id: 'col-progress', title: 'En Progreso' },
      { id: 'col-review', title: 'Revisión' },
      { id: 'col-done', title: 'Terminado' },
    ],
  },
  {
    id: 'bugs',
    name: 'Seguimiento de Bugs',
    description: 'Triaje, reproducción y verificación de incidencias.',
    columns: [
      { id: 'col-reported', title: 'Reportado' },
      { id: 'col-reproduced', title: 'Reproducido' },
      { id: 'col-fixing', title: 'Corrigiendo' },
      { id: 'col-verified', title: 'Verificado' },
    ],
  },
  {
    id: 'blank',
    name: 'Tablero Mínimo',
    description: 'Empieza con una sola columna lista para personalizar.',
    columns: [
      { id: 'col-main', title: 'Tareas' },
    ],
  },
] as const;

/** Devuelve una plantilla por ID, con fallback al Kanban clásico. */
export function getBoardTemplate(id?: string): BoardTemplate {
  return BOARD_TEMPLATES.find(t => t.id === id) ?? BOARD_TEMPLATES[0];
}
