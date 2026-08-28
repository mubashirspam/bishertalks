/**
 * A pookalam, drawn rather than photographed.
 *
 * Concentric rings of petals laid out radially, the way a real one is built up
 * from the middle outwards — each ring a different flower, each with more
 * petals than the ring inside it. The geometry is generated instead of being
 * hand-written path data: forty petals typed out by hand would be unreadable
 * and impossible to retune.
 *
 * SVG and not an image on purpose. It is a few hundred bytes inside the HTML
 * rather than a request, it stays sharp on any screen, and the colours are the
 * page's own — marigold orange is already `primary`, which is a large part of
 * why an Onam band sits comfortably on this site at all.
 *
 * Decorative, so `aria-hidden`: a screen reader announcing forty ellipses
 * helps nobody, and the greeting beside it carries the meaning.
 */

/** One ring: how many petals, how far out, how big, what colour. */
interface Ring {
  petals: number;
  /** Distance from centre to the petal's own centre. */
  radius: number;
  rx: number;
  ry: number;
  fill: string;
  /** Rotates the ring so its petals sit between the ring inside it. */
  offset?: number;
  opacity?: number;
}

/**
 * Traditional pookalam colours, warmed towards the site's orange.
 *
 * Marigold and chethi (the deep red) are what an actual pookalam is mostly
 * made of; the white and green are the rings that stop the warm colours
 * running together into one orange disc.
 */
const RINGS: Ring[] = [
  { petals: 24, radius: 88, rx: 15, ry: 8.5, fill: "#15803d", opacity: 0.9 },
  { petals: 22, radius: 74, rx: 13, ry: 8, fill: "#fbbf24", offset: 8 },
  { petals: 20, radius: 60, rx: 12, ry: 7.5, fill: "#f8fafc", opacity: 0.95 },
  { petals: 18, radius: 47, rx: 11.5, ry: 7, fill: "#dc2626", offset: 10 },
  { petals: 15, radius: 35, rx: 11, ry: 7, fill: "#f97316" },
  { petals: 12, radius: 23, rx: 10, ry: 6.5, fill: "#fbbf24", offset: 15 },
  { petals: 8, radius: 12, rx: 8, ry: 5.5, fill: "#fb923c" },
];

export default function Pookalam({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 220"
      className={className}
      role="presentation"
      aria-hidden="true"
    >
      {/* The bed the flowers sit on. Warm, so the white ring reads as petal
          rather than as a hole punched through the card. */}
      <circle cx="110" cy="110" r="104" fill="#7c2d12" opacity="0.10" />
      <circle cx="110" cy="110" r="98" fill="#fff7ed" opacity="0.55" />

      {RINGS.map((ring, i) => (
        <g key={i}>
          {Array.from({ length: ring.petals }, (_, p) => {
            const angle = (360 / ring.petals) * p + (ring.offset ?? 0);
            return (
              <ellipse
                key={p}
                cx={110 + ring.radius}
                cy={110}
                rx={ring.rx}
                ry={ring.ry}
                fill={ring.fill}
                opacity={ring.opacity ?? 1}
                // Rotate the whole petal about the centre, so it points
                // outwards the way a laid petal does.
                transform={`rotate(${angle} 110 110)`}
              />
            );
          })}
        </g>
      ))}

      {/* The eye of the pookalam. */}
      <circle cx="110" cy="110" r="7" fill="#b45309" />
      <circle cx="110" cy="110" r="3" fill="#fde68a" />
    </svg>
  );
}
