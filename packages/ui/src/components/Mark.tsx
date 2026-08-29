/** The PDFLoom brand mark — three woven ribbons forming an abstract "L". Same artwork as public/icons/mark.svg, as a themeable inline component. */
export function Mark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="PDFLoom" className={className}>
      <defs>
        <linearGradient id="pdfloom-mark-bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#181b22" />
          <stop offset="1" stopColor="#0f1115" />
        </linearGradient>
        <linearGradient id="pdfloom-mark-weave" x1="96" y1="96" x2="416" y2="416" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8f81f3" />
          <stop offset="1" stopColor="#6a5adf" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#pdfloom-mark-bg)" />
      <g strokeLinecap="round" fill="none">
        <path d="M 152 108 L 152 332 Q 152 388 208 388 L 368 388" stroke="url(#pdfloom-mark-weave)" strokeWidth="46" />
        <path d="M 232 108 L 232 300" stroke="#f2f3f5" strokeWidth="46" opacity="0.94" />
        <path d="M 312 108 L 312 388" stroke="#f5a623" strokeWidth="46" />
      </g>
    </svg>
  );
}
