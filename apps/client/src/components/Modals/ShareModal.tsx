import { useEffect, useState } from 'react';
import { X, Copy, Check, ShieldCheck, Link2, Hash } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  boardTitle: string;
  inviteToken: string;
  joinCode?: string;
  ownerId?: string;
  ownerName?: string;
}

export function ShareModal({
  isOpen,
  onClose,
  boardId,
  boardTitle,
  inviteToken,
  joinCode,
  ownerId,
  ownerName,
}: Props) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  let inviteUrl = `${window.location.origin}${window.location.pathname}#board=${encodeURIComponent(boardId)}`;
  if (inviteToken) inviteUrl += `&token=${encodeURIComponent(inviteToken)}`;
  if (ownerId) inviteUrl += `&ownerId=${encodeURIComponent(ownerId)}`;
  if (ownerName) inviteUrl += `&ownerName=${encodeURIComponent(ownerName)}`;

  const handleCopyUrl = () => {
    void navigator.clipboard.writeText(inviteUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2500);
  };

  const handleCopyCode = () => {
    if (!joinCode) return;
    void navigator.clipboard.writeText(joinCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-md rounded-xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar modal de compartir"
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 id="share-modal-title" className="text-sm font-semibold text-white">Compartir Tablero</h3>
            <p className="text-xs text-slate-400 truncate max-w-[280px]">{boardTitle}</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 my-4 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800">
          Comparte este tablero mediante código rápido o enlace directo (sin permisos de eliminación). El token viaja en el fragmento (<code className="text-slate-200">#</code>).
        </p>

        {joinCode && (
          <div className="mb-4">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-emerald-400" />
              Código de Sala Rápido
            </span>
            <div className="flex items-center justify-between bg-slate-900 border border-slate-700 p-2.5 rounded-lg">
              <span className="text-lg font-mono font-bold tracking-widest text-emerald-400 pl-2">
                {joinCode}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-medium px-3 py-1.5 rounded-md transition"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar Código</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-primary" />
          Enlace Directo
        </span>
        {inviteToken ? (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 p-2 rounded-lg mb-5">
            <input
              type="text"
              readOnly
              aria-label="Enlace de invitación"
              value={inviteUrl}
              className="w-full bg-transparent text-xs text-slate-200 focus:outline-none select-all font-mono"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className="flex-shrink-0 flex items-center gap-1.5 text-xs bg-primary hover:bg-blue-600 text-white font-medium px-3 py-1.5 rounded-md transition"
            >
              {copiedUrl ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>¡Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 p-2.5 rounded-lg mb-5">
            Te uniste mediante código rápido; comparte el código de sala superior para invitar a otros colaboradores.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
