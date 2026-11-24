import type { UserPresence } from '@kanban/shared-types';

interface Props {
  collaborator: UserPresence;
}

export function CollaboratorCursor({ collaborator }: Props) {
  const { cursor, userName, avatarColor, activity } = collaborator;
  if (!cursor) return null;

  let activityLabel = '';
  if (activity?.action === 'editing-card') {
    activityLabel = '(editando modal)';
  } else if (activity?.action === 'creating-card') {
    activityLabel = '(creando modal)';
  } else if (activity?.action === 'dragging-card') {
    activityLabel = '(arrastrando tarjeta)';
  }

  return (
    <div
      style={{
        transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`,
        transition: 'transform 75ms cubic-bezier(0, 0, 0.2, 1)'
      }}
      className="absolute top-0 left-0 pointer-events-none z-40 select-none will-change-transform"
    >
      {/* Puntero SVG coloreado */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-md -translate-x-0.5 -translate-y-0.5"
      >
        <path
          d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
          fill={avatarColor}
          stroke="#0f172a"
          strokeWidth="1.5"
        />
      </svg>

      {/* Etiqueta con el nombre del colaborador y su actividad */}
      <div
        style={{ backgroundColor: avatarColor }}
        className="ml-3.5 -mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white shadow-md whitespace-nowrap border border-black/20 flex items-center gap-1.5"
      >
        <span>{userName}</span>
        {activityLabel && (
          <span className="opacity-90 font-normal tracking-tight">{activityLabel}</span>
        )}
      </div>
    </div>
  );
}
