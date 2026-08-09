import { useEffect } from 'react';

export function useUnsavedChangesGuard(isDirty: boolean, isLongRunningOperation: boolean) {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty || isLongRunningOperation) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes or active operations. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, isLongRunningOperation]);
}
