const stages = [
  ['PREPARING', 'Preparing', 'Controller and simulation setup'],
  ['WARMUP', 'Warmup', 'Network preparation'],
  ['TRAFFIC_ACTIVE', 'Traffic active', 'Traffic job started'],
  ['FAILURE_INJECTED', 'Failure injected', 'Observing the remaining traffic'],
] as const;

export function ExecutionTimeline({ status }: { status?: string }) {
  return <div><p className="measurement-note">Reported workflow stage; not elapsed time or packet completion.</p><ol className="execution-timeline">{stages.map(([id,label,note]) => <li key={id} aria-current={status === id ? 'step' : undefined}>{label}<small>{note}</small></li>)}</ol><p className="muted">{status === 'CANCELLING' ? 'Cancellation requested. Waiting for backend cleanup.' : 'Only the current reported stage is highlighted. Recovery timing is included only when a valid event is available.'}</p></div>;
}
