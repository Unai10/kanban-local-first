export const ONBOARDING_COMPLETED_KEY = 'kanban_onboarding_completed';

export type OnboardingPlacement = 'auto' | 'right-of-target' | 'beside-modal';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  highlights?: string[];
  targetSelector?: string;
  allowTargetInteraction?: boolean;
  interactionBadge?: string;
  placement?: OnboardingPlacement;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'welcome-local-first',
    title: 'Bienvenido a Kanban Local-First',
    description:
      'Este tablero funciona bajo arquitectura Local-First: tus datos viven primero en tu dispositivo para responder en 0 ms, incluso sin conexión a internet.',
    highlights: [
      '100% funcional sin conexión gracias a IndexedDB y PWA.',
      'Sincronización en vivo sin conflictos mediante CRDT (Yjs) al reconectar.',
      'Sin registro ni contraseñas: tu identidad local y los enlaces seguros te dan control total.',
    ],
  },
  {
    id: 'sidebar-trigger',
    title: 'Abre el Menú Lateral de Tableros',
    description:
      'Pulsa este botón del menú (puedes probarlo ahora mismo) para abrir la barra lateral y ver todo lo que puedes gestionar ahí dentro.',
    targetSelector: '[data-tour="sidebar-btn"]',
    allowTargetInteraction: true,
    interactionBadge: 'Interactuable · Haz clic aquí',
  },
  {
    id: 'sidebar-panel',
    title: 'Dentro del Menú Lateral',
    description:
      'El menú lateral permanece interactivo: puedes desplazarte y explorar sus opciones antes de seguir con el recorrido.',
    highlights: [
      'Crear Nuevo Tablero desde cero o partiendo de plantillas listas para usar.',
      'Unirse por Código / Enlace rápido para colaborar en tableros de otras personas.',
      'Importar y Exportar (.json y Markdown) para copias de seguridad portables.',
      'Tus Tableros propios y compartidos, además de tu perfil local y el acceso para repetir este tutorial.',
    ],
    targetSelector: '[data-tour="sidebar-panel"]',
    allowTargetInteraction: true,
    interactionBadge: 'Menú lateral interactuable',
    placement: 'right-of-target',
  },
  {
    id: 'share-board',
    title: 'Colabora en Tiempo Real',
    description:
      'Usa "Compartir" para copiar el enlace directo o el código rápido de 6 caracteres (XXX-XXX) y trabajar en vivo con otras personas viendo sus cursores y ediciones.',
    targetSelector: '[data-tour="share-btn"]',
  },
  {
    id: 'header-tools-bar',
    title: 'Resumen, Roles, Tema y Estado Sync',
    description:
      'Toda esta barra superior reúne tus herramientas principales de control y visibilidad en tiempo real.',
    highlights: [
      'Resumen: métricas de avance, puntos y distribución por columnas o prioridad.',
      'Roles: gestión de permisos (Propietario, Admin y Miembro).',
      'Tema Claro / Oscuro, atajos de teclado (?), usuarios conectados y tu perfil.',
      'Estado Sync: indica si estás "En línea (Sync)" o trabajando en "Modo Local (IndexedDB)".',
    ],
    targetSelector: '[data-tour="header-tools-bar"]',
  },
  {
    id: 'search-filters',
    title: 'Búsqueda y Filtros Instantáneos',
    description:
      'Encuentra tarjetas en 0 ms filtrando por texto, "Mis tarjetas", prioridad, etiqueta, responsable o fecha límite. También puedes enfocarlo pulsando "/" o Ctrl+K.',
    targetSelector: '[data-tour="filter-bar"]',
  },
  {
    id: 'create-first-card',
    title: '¡Pulsa "+" para crear tu primera tarjeta!',
    description:
      'Haz clic directamente en el botón "+" de la primera columna (o pulsa "Abrir formulario") para desplegar la ventana de creación y conocer sus campos.',
    targetSelector: '[data-tour="add-card-btn"]',
    allowTargetInteraction: true,
    interactionBadge: 'Interactuable · Pulsa "+"',
  },
  {
    id: 'create-card-fields',
    title: 'Campos clave de tu tarjeta',
    description:
      'El formulario ya está abierto y puedes rellenarlo ahora mismo. Al crear la tarjeta finalizará el tutorial automáticamente.',
    highlights: [
      'Título y Columna de destino: define la tarea y en qué columna empieza.',
      'Descripción: añade especificaciones, enlaces o contexto técnico detallado.',
      'Prioridad y Fecha límite: clasifica urgencia (Baja a Urgente) y controla vencimientos.',
      'Etiquetas, Responsable, Puntos y Subtareas: organiza el trabajo y mide el progreso con checklist.',
    ],
    targetSelector: '[data-tour="create-card-modal"]',
    allowTargetInteraction: true,
    interactionBadge: 'Formulario interactuable',
    placement: 'beside-modal',
  },
] as const;

export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
  } catch {
    // Ignorar si localStorage no está disponible
  }
}
