interface ZyrquenEmblemProps {
  size?: number;
  className?: string;
}

export function ZyrquenEmblem({ size = 28, className = '' }: ZyrquenEmblemProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="33"
        height="33"
        rx="10"
        fill="#0E172B"
        stroke="url(#zyrq-border)"
        strokeWidth="1.5"
      />
      <path
        d="M10.5 11.5H25.5L11 24.5H25.5"
        stroke="url(#zyrq-stroke)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25.5" cy="11.5" r="2" fill="#22D3EE" />
      <circle cx="11" cy="24.5" r="2" fill="#8B5CF6" />
      <defs>
        <linearGradient id="zyrq-border" x1="2" y1="2" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" stopOpacity="0.65" />
          <stop offset="0.5" stopColor="#22D3EE" stopOpacity="0.5" />
          <stop offset="1" stopColor="#8B5CF6" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id="zyrq-stroke" x1="10" y1="11" x2="26" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22D3EE" />
          <stop offset="0.55" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
