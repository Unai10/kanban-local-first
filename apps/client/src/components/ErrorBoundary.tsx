import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Error inesperado en la aplicación',
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Error capturado:', error, info);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface border border-border rounded-xl p-6 shadow-2xl text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-semibold mb-2">Algo salió mal</h2>
            <p className="text-xs text-slate-400 mb-5 break-words">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 text-xs bg-primary hover:bg-blue-600 text-white font-medium px-4 py-2 rounded-lg transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
