import { useContext } from 'react';
import { BoardContext, type BoardContextValue } from './BoardContext.js';

export function useBoardContext(): BoardContextValue {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error('useBoardContext debe usarse dentro de un BoardProvider');
  }
  return context;
}
