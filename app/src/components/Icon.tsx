const PATHS = {
  grid: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Zm4 10.5a2 2 0 0 0 4 0',
  store: 'M4 9l1.5-5h13L20 9M4 9h16M4 9v10h16V9M9.5 19v-5h5v5',
  box: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  alert: 'M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 3v.01',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.5-9 2.5 2.5 4.5-5',
  xCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3-12 6 6m0-6-6 6',
  logout: 'M9 4H5v16h4M15 8l4 4-4 4M19 12H9',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5.5v.01M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5',
  search: 'm20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  x: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'm9 5 7 7-7 7',
  chevronLeft: 'm15 5-7 7 7 7',
  chevronDown: 'm5 9 7 7 7-7',
  chevronUp: 'm5 15 7-7 7 7',
  sort: 'm8 9 4-4 4 4M8 15l4 4 4-4',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M5 15v4.5h14V15',
  download: 'M12 4v12m0 0 4-4m-4 4-4-4M5 19.5h14',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 4h6v6m0-6-9 9M10 5H5v14h14v-5',
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5',
  calendar: 'M4 6.5h16v13H4v-13Zm0 4h16M8 3.5v5m8-5v5',
  trash: 'M5 7h14M10 7V4.5h4V7m-7 0 1 12.5h8L17 7',
  edit: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 3 21.5l1-4.5L17 3Z',
  filter: 'M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z',
  copy: 'M9 9h10v11H9V9Zm-4 6V4h10',
  arrowRight: 'M5 12h14m0 0-5-5m5 5-5 5',
  arrowUp: 'M12 19V5m0 0-5 5m5-5 5 5',
  arrowDown: 'M12 5v14m0 0 5-5m-5 5-5-5',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9v.01',
  file: 'M7 3h7l4 4v14H7V3Zm7 0v4h4M9.5 12h5m-5 3.5h5',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className = 'icon' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
