import { useEffect, useRef } from 'react';

const points = [
  { id: 'h1', x: 54, y: 230, host: true }, { id: 's1', x: 170, y: 230 },
  { id: 's2', x: 310, y: 110 }, { id: 's3', x: 310, y: 350 },
  { id: 's4', x: 450, y: 230 }, { id: 'h2', x: 566, y: 230, host: true },
];

export function NetworkIllustration() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const figure = ref.current;
    if (!figure) return;
    let visible = true;
    const update = () => { figure.dataset.playing = String(visible && !document.hidden); };
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      update();
    }) : null;
    observer?.observe(figure);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  return <figure ref={ref} className="network-illustration">
    <figcaption><span className="eyebrow">A resilient path forward</span><span>Illustration · not live telemetry</span></figcaption>
    <svg viewBox="0 0 620 460" role="img" aria-labelledby="network-title network-description">
      <title id="network-title">The redundant diamond network</title>
      <desc id="network-description">Illustrative loop: traffic takes the upper branch, the s1 to s2 link fails, and the lower branch carries traffic. This demonstrates a recovery strategy, not a live measurement.</desc>
      <defs><pattern id="network-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#465449" /></pattern></defs>
      <rect width="620" height="460" fill="url(#network-grid)"/>
      <g className="illustration-links" fill="none" strokeWidth="2">
        <path className="access-path" d="M54 230H170M450 230H566"/>
        <path className="primary-tail" d="m310 110 140 120"/>
        <path className="failure-link" d="m170 230 140-120"/>
        <path className="backup-path" d="m170 230 140 120 140-120"/>
      </g>
      <path className="packet packet-primary" pathLength="1000" d="M54 230H170L310 110 450 230H566"/>
      <path className="packet packet-backup" pathLength="1000" d="M54 230H170L310 350 450 230H566"/>
      <g className="failure-symbol"><circle cx="240" cy="170" r="13" fill="#26332d"/><path d="m235 165 10 10m0-10-10 10" stroke="#ed8c7e" strokeWidth="2"/><rect x="200" y="128" width="80" height="23" rx="3" fill="#482e2a"/><text x="240" y="143" textAnchor="middle" fill="#f3a697" fontSize="10" fontFamily="monospace">LINK DOWN</text></g>
      {points.map(n => <g className={`illustration-node node-${n.id}`} key={n.id} transform={`translate(${n.x},${n.y})`}>
        <rect x="-27" y="-24" width="54" height="48" rx={n.host ? 4 : 9}/>
        <path d={n.host ? 'M-9-9H9V4H-9ZM-5 10H5M0 4v6' : 'M-12-6H12M-12 1H12M-10 8h3m5 0h3m5 0h3'} fill="none" strokeWidth="2"/>
        <text y="43" textAnchor="middle" fontSize="12" fontFamily="monospace">{n.id}</text>
      </g>)}
      <g fontSize="10" fill="#94a492" fontFamily="monospace"><text x="310" y="50" textAnchor="middle">01 / PRIMARY BRANCH</text><text x="310" y="422" textAnchor="middle">02 / ALTERNATE BRANCH</text></g>
    </svg>
    <div className="illustration-story" aria-hidden="true"><span className="story-primary"><i/>01 / HEALTHY · PRIMARY FORWARDING</span><span className="story-failure"><i/>02 / LINK DOWN · PATH INTERRUPTED</span><span className="story-recovery"><i/>03 / PATH RECOVERED · ALTERNATE FORWARDING</span></div>
    <p className="sr-only">Illustrative sequence: healthy network, link failure, alternate path recovery.</p>
  </figure>;
}
