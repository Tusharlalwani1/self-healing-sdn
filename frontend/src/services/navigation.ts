import type { NavigationTab } from '../stores/sdnStore';

export const dashboardPages: Record<NavigationTab, string> = {
  overview: 'NOC Overview', topology: 'Network Topology', controllers: 'Controllers', traffic: 'Traffic Monitor',
  simulator: 'Failure Simulator', experiment: 'Experiment Lab', analytics: 'Analytics', logs: 'Event Logs', settings: 'System & Config',
};
export function dashboardPath(tab: NavigationTab): string { return tab === 'overview' ? '/dashboard' : `/dashboard/${tab}`; }
export function tabFromPath(path: string): NavigationTab | null {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/dashboard') return 'overview';
  const tab = clean.replace(/^\/dashboard\//, '');
  return clean.startsWith('/dashboard/') && Object.hasOwn(dashboardPages, tab) ? tab as NavigationTab : null;
}
