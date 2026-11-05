export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><svg width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true"><path d="M15 2 28 10v14L15 32 2 24V10Z" stroke="currentColor" strokeWidth="1.5"/><path d="m2 10 13 8 13-8M15 18v14M8 14l7-4 7 4" stroke="currentColor" strokeWidth="1.5"/></svg><span>Self-healing<span className="brand-sub">{compact ? 'SDN / CONTROL CENTER' : 'SOFTWARE DEFINED NETWORKING'}</span></span></span>;
}
