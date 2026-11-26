import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Sparkles, ChevronLeft, ChevronRight, Plus, CheckCircle2, MousePointerClick } from 'lucide-react';
import { ONBOARDING_STEPS, type OnboardingStep } from '../core/constants/onboarding.js';

interface Props {
  isOpen: boolean;
  isSidebarOpen: boolean;
  isCreateCardModalOpen: boolean;
  isPausedBySubModal?: boolean;
  onOpenSidebar: () => void;
  onCloseSidebar: () => void;
  onOpenFirstCardModal: () => void;
  onCloseCreateCardModal: () => void;
  onComplete: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SIDEBAR_TRIGGER_INDEX = ONBOARDING_STEPS.findIndex(s => s.id === 'sidebar-trigger');
const SIDEBAR_PANEL_INDEX = ONBOARDING_STEPS.findIndex(s => s.id === 'sidebar-panel');
const CREATE_CARD_TRIGGER_INDEX = ONBOARDING_STEPS.findIndex(s => s.id === 'create-first-card');
const CREATE_CARD_FIELDS_INDEX = ONBOARDING_STEPS.findIndex(s => s.id === 'create-card-fields');

function measureTarget(selector?: string): TargetRect | null {
  if (!selector || typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function computePopoverStyle(
  step: OnboardingStep,
  targetRect: TargetRect | null,
  viewportWidth: number,
  viewportHeight: number
): { style: CSSProperties | undefined; compactMobileScroll: boolean } {
  if (!targetRect) {
    return { style: undefined, compactMobileScroll: false };
  }

  const cardWidth = Math.min(400, viewportWidth - 24);

  if (step.placement === 'right-of-target') {
    const spaceRight = viewportWidth - (targetRect.left + targetRect.width);
    if (spaceRight >= 300) {
      const width = Math.min(400, spaceRight - 28);
      const left = targetRect.left + targetRect.width + 16;
      const top = Math.min(Math.max(16, Math.round(viewportHeight / 2 - 190)), Math.max(16, viewportHeight - 420));
      return {
        style: { position: 'fixed', top: `${top}px`, left: `${left}px`, width: `${width}px` },
        compactMobileScroll: false,
      };
    }
    return {
      style: {
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: '12px',
        maxHeight: '46dvh',
      },
      compactMobileScroll: true,
    };
  }

  if (step.placement === 'beside-modal') {
    const spaceRight = viewportWidth - (targetRect.left + targetRect.width);
    const spaceLeft = targetRect.left;
    if (spaceRight >= 290) {
      const width = Math.min(360, spaceRight - 24);
      const left = targetRect.left + targetRect.width + 14;
      const top = Math.min(Math.max(16, targetRect.top + 12), Math.max(16, viewportHeight - 430));
      return {
        style: { position: 'fixed', top: `${top}px`, left: `${left}px`, width: `${width}px` },
        compactMobileScroll: false,
      };
    }
    if (spaceLeft >= 290) {
      const width = Math.min(360, spaceLeft - 24);
      const left = targetRect.left - width - 14;
      const top = Math.min(Math.max(16, targetRect.top + 12), Math.max(16, viewportHeight - 430));
      return {
        style: { position: 'fixed', top: `${top}px`, left: `${left}px`, width: `${width}px` },
        compactMobileScroll: false,
      };
    }
    return {
      style: {
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: '12px',
        maxHeight: '38dvh',
      },
      compactMobileScroll: true,
    };
  }

  const estHeight = step.highlights && step.highlights.length > 0 ? 340 : 250;
  const spaceBelow = viewportHeight - (targetRect.top + targetRect.height);
  const placeBelow = spaceBelow >= estHeight || targetRect.top < 220;
  const rawTop = placeBelow
    ? targetRect.top + targetRect.height + 14
    : Math.max(12, targetRect.top - estHeight - 14);
  const clampedTop = Math.min(Math.max(12, rawTop), Math.max(12, viewportHeight - estHeight - 12));
  const preferredLeft = targetRect.left + targetRect.width / 2 - cardWidth / 2;
  const clampedLeft = Math.min(Math.max(12, preferredLeft), viewportWidth - cardWidth - 12);

  return {
    style: {
      position: 'fixed',
      top: `${clampedTop}px`,
      left: `${clampedLeft}px`,
      width: `${cardWidth}px`,
    },
    compactMobileScroll: false,
  };
}

function OnboardingTourContent({
  isSidebarOpen,
  isCreateCardModalOpen,
  isPausedBySubModal = false,
  onOpenSidebar,
  onCloseSidebar,
  onOpenFirstCardModal,
  onCloseCreateCardModal,
  onComplete,
}: Omit<Props, 'isOpen'>) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [prevSidebarOpen, setPrevSidebarOpen] = useState(isSidebarOpen);
  const [prevCreateCardModalOpen, setPrevCreateCardModalOpen] = useState(isCreateCardModalOpen);

  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];

  // Sincronización reactiva cuando el usuario hace clic real en el botón del sidebar o en "+"
  if (isSidebarOpen !== prevSidebarOpen) {
    setPrevSidebarOpen(isSidebarOpen);
    if (isSidebarOpen && step.id === 'sidebar-trigger' && SIDEBAR_PANEL_INDEX >= 0) {
      setStepIndex(SIDEBAR_PANEL_INDEX);
    } else if (!isSidebarOpen && step.id === 'sidebar-panel' && SIDEBAR_TRIGGER_INDEX >= 0) {
      setStepIndex(SIDEBAR_TRIGGER_INDEX);
    }
  }

  if (isCreateCardModalOpen !== prevCreateCardModalOpen) {
    setPrevCreateCardModalOpen(isCreateCardModalOpen);
    if (isCreateCardModalOpen && step.id === 'create-first-card' && CREATE_CARD_FIELDS_INDEX >= 0) {
      setStepIndex(CREATE_CARD_FIELDS_INDEX);
    } else if (!isCreateCardModalOpen && step.id === 'create-card-fields' && CREATE_CARD_TRIGGER_INDEX >= 0) {
      setStepIndex(CREATE_CARD_TRIGGER_INDEX);
    }
  }

  const activeStep = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;

  const goToStep = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, nextIndex));
    const targetStep = ONBOARDING_STEPS[clamped];

    if (targetStep.id === 'sidebar-panel') {
      if (!isSidebarOpen) {
        setPrevSidebarOpen(true);
        onOpenSidebar();
      }
    } else if (isSidebarOpen) {
      setPrevSidebarOpen(false);
      onCloseSidebar();
    }

    if (targetStep.id === 'create-card-fields') {
      if (!isCreateCardModalOpen) {
        setPrevCreateCardModalOpen(true);
        onOpenFirstCardModal();
      }
    } else if (isCreateCardModalOpen) {
      setPrevCreateCardModalOpen(false);
      onCloseCreateCardModal();
    }

    setStepIndex(clamped);
  }, [isSidebarOpen, isCreateCardModalOpen, onOpenSidebar, onCloseSidebar, onOpenFirstCardModal, onCloseCreateCardModal]);

  const handleExitTour = useCallback(() => {
    if (isSidebarOpen) onCloseSidebar();
    if (isCreateCardModalOpen) onCloseCreateCardModal();
    onComplete();
  }, [isSidebarOpen, isCreateCardModalOpen, onCloseSidebar, onCloseCreateCardModal, onComplete]);

  useEffect(() => {
    if (isPausedBySubModal) return;

    const updateRect = () => {
      setTargetRect(measureTarget(activeStep.targetSelector));
    };

    const rafId = window.requestAnimationFrame(updateRect);
    const timerId = window.setTimeout(updateRect, 80);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [activeStep.targetSelector, isSidebarOpen, isCreateCardModalOpen, isPausedBySubModal]);

  useEffect(() => {
    if (isPausedBySubModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      if (e.key === 'Escape') {
        if (!isSidebarOpen && !isCreateCardModalOpen) {
          handleExitTour();
        }
      } else if (e.key === 'ArrowRight' && stepIndex < ONBOARDING_STEPS.length - 1) {
        goToStep(stepIndex + 1);
      } else if (e.key === 'ArrowLeft' && stepIndex > 0) {
        goToStep(stepIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepIndex, isSidebarOpen, isCreateCardModalOpen, isPausedBySubModal, goToStep, handleExitTour]);

  if (isPausedBySubModal) return null;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768;
  const { style: popoverStyle, compactMobileScroll } = computePopoverStyle(
    activeStep,
    targetRect,
    viewportWidth,
    viewportHeight
  );

  const cutoutPadding =
    activeStep.id === 'sidebar-panel'
      ? 0
      : activeStep.id === 'create-card-modal'
      ? 2
      : 5;

  const cutTop = targetRect ? Math.max(0, targetRect.top - cutoutPadding) : 0;
  const cutLeft = targetRect ? Math.max(0, targetRect.left - cutoutPadding) : 0;
  const cutRight = targetRect ? Math.min(viewportWidth, targetRect.left + targetRect.width + cutoutPadding) : 0;
  const cutBottom = targetRect ? Math.min(viewportHeight, targetRect.top + targetRect.height + cutoutPadding) : 0;
  const cutWidth = Math.max(0, cutRight - cutLeft);
  const cutHeight = Math.max(0, cutBottom - cutTop);

  const showFloatingTriggerBadge = Boolean(
    activeStep.allowTargetInteraction &&
    activeStep.interactionBadge &&
    activeStep.placement !== 'right-of-target' &&
    activeStep.placement !== 'beside-modal'
  );

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-step-title"
    >
      {/* Fondo bloqueador: nunca cierra el tutorial al clicar fuera */}
      {targetRect ? (
        <>
          {activeStep.allowTargetInteraction ? (
            <>
              {/* 4 bloques perimetrales para dejar interactuable solo el área del objetivo */}
              {cutTop > 0 && (
                <div
                  aria-hidden="true"
                  className="fixed top-0 left-0 right-0 pointer-events-auto"
                  style={{ height: `${cutTop}px` }}
                />
              )}
              {cutBottom < viewportHeight && (
                <div
                  aria-hidden="true"
                  className="fixed left-0 right-0 bottom-0 pointer-events-auto"
                  style={{ top: `${cutBottom}px` }}
                />
              )}
              {cutLeft > 0 && cutHeight > 0 && (
                <div
                  aria-hidden="true"
                  className="fixed left-0 pointer-events-auto"
                  style={{ top: `${cutTop}px`, width: `${cutLeft}px`, height: `${cutHeight}px` }}
                />
              )}
              {cutRight < viewportWidth && cutHeight > 0 && (
                <div
                  aria-hidden="true"
                  className="fixed right-0 pointer-events-auto"
                  style={{ top: `${cutTop}px`, left: `${cutRight}px`, height: `${cutHeight}px` }}
                />
              )}
            </>
          ) : (
            <div aria-hidden="true" className="fixed inset-0 pointer-events-auto" />
          )}

          {/* Marco visual del spotlight */}
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: `${cutTop}px`,
              left: `${cutLeft}px`,
              width: `${cutWidth}px`,
              height: `${cutHeight}px`,
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.72)',
            }}
            className={`pointer-events-none transition-all duration-200 ${
              activeStep.id === 'sidebar-panel' ? 'rounded-none' : 'rounded-xl'
            } ${
              activeStep.allowTargetInteraction
                ? 'ring-2 ring-primary shadow-[0_0_24px_rgba(59,130,246,0.55)]'
                : 'ring-2 ring-primary'
            }`}
          />

          {showFloatingTriggerBadge && (
            <div
              aria-hidden="true"
              style={{
                position: 'fixed',
                top: `${Math.max(6, cutTop - 26)}px`,
                left: `${Math.min(Math.max(8, cutLeft), Math.max(8, viewportWidth - 190))}px`,
              }}
              className="pointer-events-none inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary text-white text-[10px] font-semibold shadow-lg animate-pulse"
            >
              <MousePointerClick className="w-3 h-3" />
              <span>{activeStep.interactionBadge}</span>
            </div>
          )}
        </>
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-black/70 backdrop-blur-[1px] pointer-events-auto"
        />
      )}

      {/* Tarjeta del paso actual */}
      <div
        className={
          targetRect
            ? 'z-[61] pointer-events-none'
            : 'fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none'
        }
        style={targetRect ? popoverStyle : undefined}
      >
        <div
          onClick={e => e.stopPropagation()}
          className={`pointer-events-auto bg-surface border border-border rounded-2xl shadow-2xl p-4 sm:p-5 w-full space-y-3.5 animate-in fade-in zoom-in-95 duration-150 ${
            compactMobileScroll ? 'overflow-y-auto max-h-full' : 'max-w-md'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary/20 text-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary truncate">
                Paso {stepIndex + 1} de {ONBOARDING_STEPS.length}
              </span>
            </div>
            <button
              type="button"
              onClick={handleExitTour}
              className="text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200 px-2.5 py-1 rounded-lg hover:bg-red-500/15 transition shrink-0"
            >
              Saltar tutorial
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="onboarding-step-title" className="text-sm sm:text-base font-semibold text-ink">
                {activeStep.title}
              </h3>
              {activeStep.allowTargetInteraction && activeStep.interactionBadge && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-blue-700 dark:text-blue-300 border border-primary/30">
                  <MousePointerClick className="w-3 h-3" />
                  {activeStep.interactionBadge}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {activeStep.description}
            </p>
            {activeStep.highlights && activeStep.highlights.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {activeStep.highlights.map(item => (
                  <li key={item} className="flex items-start gap-2 text-xs text-slate-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Indicadores de progreso */}
          <div className="flex items-center justify-center gap-1.5 pt-1">
            {ONBOARDING_STEPS.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Ir al paso ${idx + 1}`}
                onClick={() => goToStep(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === stepIndex ? 'w-5 bg-primary' : 'w-1.5 bg-slate-700 hover:bg-slate-500'
                }`}
              />
            ))}
          </div>

          {/* Navegación */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/80">
            <button
              type="button"
              disabled={isFirstStep}
              onClick={() => goToStep(stepIndex - 1)}
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-ink disabled:opacity-30 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 transition"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>

            <div className="flex items-center gap-2">
              {activeStep.id === 'create-first-card' ? (
                <button
                  type="button"
                  onClick={() => goToStep(stepIndex + 1)}
                  className="flex items-center gap-1.5 text-xs bg-primary hover:bg-blue-600 text-white font-medium px-3.5 py-1.5 rounded-lg transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Abrir formulario
                </button>
              ) : isLastStep ? (
                <button
                  type="button"
                  onClick={handleExitTour}
                  className="flex items-center gap-1 text-xs bg-primary hover:bg-blue-600 text-white font-medium px-3.5 py-1.5 rounded-lg transition"
                >
                  Finalizar tutorial
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => goToStep(stepIndex + 1)}
                  className="flex items-center gap-1 text-xs bg-primary hover:bg-blue-600 text-white font-medium px-3.5 py-1.5 rounded-lg transition"
                >
                  {isFirstStep ? 'Empezar recorrido' : 'Siguiente'}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tour guiado interactivo de bienvenida para nuevos usuarios:
 * explica la arquitectura Local-First, permite interactuar con el sidebar
 * y el creador de tarjetas, y nunca se cierra al hacer clic fuera.
 */
export function OnboardingTour({ isOpen, ...rest }: Props) {
  if (!isOpen) return null;
  return <OnboardingTourContent {...rest} />;
}
