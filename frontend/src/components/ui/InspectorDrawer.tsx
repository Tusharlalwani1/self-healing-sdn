import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal semantics provide focus containment, Escape and focus return. */
export function InspectorDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="inspector" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}>{children}</dialog>;
}
