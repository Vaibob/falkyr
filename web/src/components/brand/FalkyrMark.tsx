// The Falkyr mark — an abstract falcon head in right profile, cut from three
// sharp planes (skull, beak wedge, neck) with one gold eye. The silhouette is
// currentColor so it works on any theme; the eye is always falcon-gold.
// Geometry lives on a 32×32 grid. See jobpilot-saas/DESIGN.md §1.

import type { CSSProperties } from 'react';

const GOLD = '#E8A33D';

// The three planes. Thin negative-space gaps trace the anatomy: the cere line
// (head/beak), the mouth line (beak/chin), and the jaw line (head/neck).
const SKULL = '4.4,11 12.6,6.4 19,7 22.4,8.7 21.6,10.1 21.2,12.9 22.9,14.9 13.7,18.8 4.2,22.3';
const BEAK = '22.5,9.8 29.4,13.9 21.9,13.6';
const NECK = '4.2,23 14,19.3 9.2,25.6 4.2,25.6';
const EYE = { cx: 17.6, cy: 11.3, r: 3.2 };

/** The falcon-head mark. Reads down to 14px. Silhouette inherits currentColor. */
export function FalkyrMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Falkyr"
      className={className}
    >
      <polygon fill="currentColor" points={SKULL} />
      <polygon fill="currentColor" points={BEAK} />
      <polygon fill="currentColor" points={NECK} />
      <circle fill={GOLD} cx={EYE.cx} cy={EYE.cy} r={EYE.r} />
    </svg>
  );
}

/** Mark + lowercase wordmark, per BRAND.md. */
export function FalkyrLogo({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <FalkyrMark size={size} />
      <span
        className="font-display font-semibold"
        style={{ fontSize: size * 0.78, letterSpacing: '-0.02em' }}
      >
        falkyr
      </span>
    </span>
  );
}

/**
 * Hero entrance: the same geometry, but each plane glides in from a small
 * offset/rotation (700ms, ease-stoop, staggered 0/90/180ms) and the gold eye
 * lands last with a single blink — the bird is awake. Animations are defined
 * in index.css (.falkyr-plane / .falkyr-eye) and neutralized under
 * prefers-reduced-motion.
 */
export function FalkyrHeroMark({ size = 120, className = '' }: { size?: number; className?: string }) {
  const plane = (dx: number, dy: number, dr: number, delay: number): CSSProperties =>
    ({
      '--dx': `${dx}px`,
      '--dy': `${dy}px`,
      '--dr': `${dr}deg`,
      animationDelay: `${delay}ms`,
    }) as CSSProperties;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Falkyr"
      className={className}
    >
      <polygon className="falkyr-plane" style={plane(-10, -6, -3, 0)} fill="currentColor" points={SKULL} />
      <polygon className="falkyr-plane" style={plane(-8, 12, 2, 90)} fill="currentColor" points={NECK} />
      <polygon className="falkyr-plane" style={plane(14, -4, 4, 180)} fill="currentColor" points={BEAK} />
      <circle className="falkyr-eye" fill={GOLD} cx={EYE.cx} cy={EYE.cy} r={EYE.r} />
    </svg>
  );
}
