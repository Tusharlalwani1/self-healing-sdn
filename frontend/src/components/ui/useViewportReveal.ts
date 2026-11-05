import { useEffect, type RefObject } from 'react';

/** Presentation only: observe each section once; never hide content awaiting JS. */
export function useViewportReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!element || !('IntersectionObserver' in window)) return;
    const animations = new Set<Animation>();
    const revealed = new WeakSet<Element>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (revealed.has(entry.target)) continue;
        revealed.add(entry.target);
        entry.target.setAttribute('data-revealed', 'true');
        if (media.matches) continue;
        const targets = entry.target.querySelectorAll<HTMLElement>('[data-reveal]');
        targets.forEach((target, index) => {
          if (typeof target.animate !== 'function') return;
          const animation = target.animate([
            { opacity: 0.35, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], { duration: 540, delay: Math.min(index * 85, 425), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        });
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' });
    element.querySelectorAll('[data-reveal-group]').forEach(section => observer.observe(section));
    const reduce = () => { if (media.matches) { animations.forEach(animation => animation.cancel()); animations.clear(); } };
    media.addEventListener('change', reduce);
    return () => { observer.disconnect(); media.removeEventListener('change', reduce); animations.forEach(animation => animation.cancel()); };
  }, [root]);
}
