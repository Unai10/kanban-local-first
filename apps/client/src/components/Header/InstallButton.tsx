import { Download } from 'lucide-react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';

export function InstallButton() {
  const { isInstallable, promptInstall } = useInstallPrompt();

  if (!isInstallable) return null;

  return (
    <button
      type="button"
      onClick={promptInstall}
      aria-label="Instalar aplicación"
      className="flex items-center gap-1.5 text-xs bg-primary/20 text-blue-300 border border-primary/40 px-2 md:px-3 py-1 rounded-full hover:bg-primary/30 transition"
      title="Instalar aplicación"
    >
      <Download className="w-3.5 h-3.5 shrink-0" />
      <span className="hidden md:inline">Instalar App</span>
    </button>
  );
}
