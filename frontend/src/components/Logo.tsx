interface LogoProps {
  size?: number
  className?: string
  showText?: boolean
}

export function Logo({ size = 32, className = '', showText = true }: LogoProps) {
  return (
    <div className={`brand-logo-wrap ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.65rem' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="brand-logo-svg"
      >
        <rect width="32" height="32" rx="8" fill="#4F46E5" />
        {/* Ticket queue / pulse icon */}
        <path
          d="M8 11.5C8 10.6716 8.67157 10 9.5 10H22.5C23.3284 10 24 10.6716 24 11.5V13.5C22.8954 13.5 22 14.3954 22 15.5C22 16.6046 22.8954 17.5 24 17.5V20.5C24 21.3284 23.3284 22 22.5 22H9.5C8.67157 22 8 21.3284 8 20.5V17.5C9.10457 17.5 10 16.6046 10 15.5C10 14.3954 9.10457 13.5 8 13.5V11.5Z"
          fill="#FFFFFF"
          fillOpacity="0.18"
        />
        {/* Crisp pulse queue signal */}
        <path
          d="M10 16H13L14.75 12.5L17.25 19.5L19 16H22"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && <span className="brand-wordmark">QuickQueue</span>}
    </div>
  )
}

