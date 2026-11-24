import type { Label } from '@kanban/shared-types';

export const PRESET_LABELS: readonly Omit<Label, 'id'>[] = [
  { name: 'Feature', color: '#3b82f6' },
  { name: 'Bug', color: '#ef4444' },
  { name: 'Urgente', color: '#f59e0b' },
  { name: 'Documentación', color: '#10b981' },
];
