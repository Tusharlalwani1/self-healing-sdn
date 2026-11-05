import type { ReactNode } from 'react';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{actions && <div className="heading-actions">{actions}</div>}</header>;
}
export function Panel({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <header className="panel-heading"><h2>{title}</h2>{aside}</header>}{children}</section>;
}
export function Metric({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className="metric"><dt>{label}</dt><dd key={String(value)} className="metric-value">{value}</dd>{note && <p>{note}</p>}</div>;
}
export function Status({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warning' | 'bad' }) {
  return <span key={`${tone}:${String(children)}`} className={`status status-${tone}`}><span aria-hidden="true" className="status-mark" />{children}</span>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
