import { ErrorBoundary } from './components/ErrorBoundary.js';
import { BoardProvider } from './features/boards/context/BoardProvider.js';
import { KanbanWorkspace } from './features/kanban/components/KanbanWorkspace.js';

export default function App() {
  return (
    <ErrorBoundary>
      <BoardProvider>
        <KanbanWorkspace />
      </BoardProvider>
    </ErrorBoundary>
  );
}
