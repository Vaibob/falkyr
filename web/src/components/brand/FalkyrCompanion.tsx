// The living Falkyr — the same mark geometry as FalkyrMark, awake.
// The gold eye follows the cursor (a working bird watches the room), blinks
// on a slow idle cycle, and when `hunting` (e.g. a scan is running) the eye
// pulses and the whole bird leans in. Pure CSS + one rAF-throttled mousemove;
// no dependencies. Reduced motion: tracking and blinking are disabled here
// (JS-gated), and the pulse is neutralized in index.css.

import { useEffect, useRef } from 'react';

const GOLD = '#E8A33D';

// Shared geometry (kept in sync with FalkyrMark.tsx).
const SKULL = '4.4,11 12.6,6.4 19,7 22.4,8.7 21.6,10.1 21.2,12.9 22.9,14.9 13.7,18.8 4.2,22.3';
const BEAK = '22.5,9.8 29.4,13.9 21.9,13.6';
const NECK = '4.2,23 14,19.3 9.2,25.6 4.2,25.6';
const EYE = { cx: 17.6, cy: 11.3, r: 3.2 };

export function FalkyrCompanion({
  size = 26,
  hunting = false,
  className = '',
}: {
  size?: number;
  /** True while Falkyr is actively working (scanning/generating) — the eye pulses. */
  hunting?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pupilRef = useRef<SVGCircleElement | null>(null);

  // Cursor tracking: move the pupil up to ~1.1 viewBox units toward the cursor.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const svg = svgRef.current;
        const pupil = pupilRef.current;
        if (!svg || !pupil) return;
        const r = svg.getBoundingClientRect();
        const cx = r.left + r.width * (EYE.cx / 32);
        const cy = r.top + r.height * (EYE.cy / 32);
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const d = Math.hypot(dx, dy) || 1;
        const reach = 1.1; // viewBox units
        pupil.style.transform = `translate(${(dx / d) * reach}px, ${(dy / d) * reach}px)`;
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={hunting ? 'Falkyr — on the wing' : 'Falkyr'}
      className={`${hunting ? 'falkyr-hunting' : ''} ${className}`}
    >
      <polygon fill="currentColor" points={SKULL} />
      <polygon fill="currentColor" points={BEAK} />
      <polygon fill="currentColor" points={NECK} />
      {/* Eye group blinks (scaleY squash) on an idle cycle; pulses when hunting. */}
      <g className="falkyr-companion-eye">
        <circle fill={GOLD} cx={EYE.cx} cy={EYE.cy} r={EYE.r} />
        <circle
          ref={pupilRef}
          className="falkyr-pupil"
          fill="#0B0E14"
          cx={EYE.cx}
          cy={EYE.cy}
          r={1.35}
        />
      </g>
    </svg>
  );
}
