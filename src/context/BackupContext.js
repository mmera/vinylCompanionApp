import { createContext, useContext } from 'react';

import { useBackupSync } from '../hooks/useBackupSync';
import { useCollection } from './CollectionContext';

/**
 * Exposes backup state to Settings.
 *
 * The sync itself has to run whether or not anyone is looking at it, so it is
 * mounted once at the root rather than by the screen that reports it —
 * otherwise backups would only happen while Settings was open.
 */

const BackupContext = createContext(null);

export function BackupProvider({ children }) {
  const { records, isLoading } = useCollection();
  const backup = useBackupSync({ records, isLoading });

  return <BackupContext.Provider value={backup}>{children}</BackupContext.Provider>;
}

export function useBackup() {
  const context = useContext(BackupContext);
  if (!context) {
    throw new Error('useBackup must be used inside a BackupProvider.');
  }
  return context;
}
