const P: Record<string, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  rocket: 'M12 2c3 2 5 6 5 10l-2 4H9l-2-4c0-4 2-8 5-10zM9 16l-3 4M15 16l3 4M12 9a1.5 1.5 0 1 0 0 .01',
  play: 'M7 4l13 8-13 8V4z', pause: 'M7 4h4v16H7zM13 4h4v16h-4z', reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5', replay: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8', database: 'M12 3c5 0 8 1.3 8 3s-3 3-8 3-8-1.3-8-3 3-3 8-3zM4 6v6c0 1.7 3 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3 3 8 3s8-1.3 8-3v-6',
  plus: 'M12 5v14M5 12h14', edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15V4h11', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', check: 'M5 12l5 5 9-10', alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.01',
  chevron: 'M6 9l6 6 6-6', x: 'M6 6l12 12M18 6L6 18', menu: 'M4 6h16M4 12h16M4 18h16', target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12v.01',
  compare: 'M8 3v18M16 3v18M3 8h5M16 16h5', download: 'M12 4v12M7 11l5 5 5-5M4 20h16', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18', info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5v.01', mountain: 'M3 20l6-11 4 6 3-4 5 9H3z',
}

export function Icon({ name, size = 16, className = '' }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[name] ?? P.info} />
    </svg>
  )
}
