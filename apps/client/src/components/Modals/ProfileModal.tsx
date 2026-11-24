import { useEffect, useState, type FormEvent } from 'react';
import { X, UserCheck, Check } from 'lucide-react';
import { LIMITS, sanitizeSingleLineText, type UserProfile } from '@kanban/shared-types';
import { AVATAR_COLORS } from '../../core/storage/localUserRepository.js';

interface Props {
  isOpen: boolean;
  user: UserProfile;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
}

function ProfileModalContent({ user, onClose, onSave }: Omit<Props, 'isOpen'>) {
  const [name, setName] = useState(user.name);
  const [color, setColor] = useState(user.color);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const cleanName = sanitizeSingleLineText(name, LIMITS.USER_NAME_MAX);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!cleanName) return;
    onSave(cleanName, color);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-modal-title"
    >
      <div
        className="bg-surface border border-border w-full max-w-sm rounded-xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar editor de perfil"
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white"
            style={{ backgroundColor: color }}
          >
            <UserCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 id="profile-modal-title" className="text-sm font-semibold text-white">
              Tu Perfil Local
            </h3>
            <p className="text-[11px] text-slate-400 font-mono truncate max-w-[230px]">
              ID: {user.id}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="profile-name-input" className="text-xs text-slate-300 block mb-1.5 font-medium">
            Nombre visible ({cleanName.length}/{LIMITS.USER_NAME_MAX})
          </label>
          <input
            id="profile-name-input"
            type="text"
            autoFocus
            maxLength={LIMITS.USER_NAME_MAX}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Tu nombre..."
            className="w-full bg-slate-900 border border-slate-700 text-white text-sm px-3 py-2 rounded-lg mb-4 focus:outline-none focus:border-primary"
          />

          <span className="text-xs text-slate-300 block mb-2 font-medium">Color de avatar y cursor</span>
          <div className="flex flex-wrap gap-2 mb-6">
            {AVATAR_COLORS.map(presetColor => {
              const selected = color.toLowerCase() === presetColor.toLowerCase();
              return (
                <button
                  key={presetColor}
                  type="button"
                  onClick={() => setColor(presetColor)}
                  aria-label={`Seleccionar color ${presetColor}`}
                  style={{ backgroundColor: presetColor }}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                    selected ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                >
                  {selected && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!cleanName}
              className="text-xs bg-primary hover:bg-blue-600 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition"
            >
              Guardar Perfil
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProfileModal({ isOpen, user, onClose, onSave }: Props) {
  if (!isOpen) return null;
  return <ProfileModalContent key={user.id} user={user} onClose={onClose} onSave={onSave} />;
}
