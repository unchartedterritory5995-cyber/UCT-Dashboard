// Tiny inline-SVG icon set for the prototype (UI chrome only — the emoji
// reactions are a separate, deliberate feature). Stroke uses currentColor so
// callers control color via CSS.
const S = ({ children, size = 18, fill = 'none', ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
    strokeLinejoin="round" {...p}>{children}</svg>
)

export const IconUp = (p) => <S {...p}><path d="M12 5l7 8H5z" fill="currentColor" stroke="none" /></S>
export const IconDown = (p) => <S {...p}><path d="M12 19l-7-8h14z" fill="currentColor" stroke="none" /></S>
export const IconSearch = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></S>
export const IconComment = (p) => <S {...p}><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" /></S>
export const IconShare = (p) => <S {...p}><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></S>
export const IconBookmark = (p) => <S {...p}><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></S>
export const IconPlus = (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>
export const IconBack = (p) => <S {...p}><path d="M15 18l-6-6 6-6" /></S>
export const IconChevron = (p) => <S {...p}><path d="M6 9l6 6 6-6" /></S>
export const IconFlame = (p) => <S {...p}><path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s0 2 2 2c0-3 2-5 2-8z" /></S>
export const IconSparkle = (p) => <S {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></S>
export const IconTop = (p) => <S {...p}><path d="M4 20h16" /><path d="M7 20V10M12 20V4M17 20v-7" /></S>
export const IconHelp = (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.5-1 .9-1 1.7" /><path d="M12 17h.01" /></S>
export const IconHome = (p) => <S {...p}><path d="M4 11l8-7 8 7" /><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" /></S>
export const IconChat = (p) => <S {...p}><path d="M4 5h16v11H8l-4 4z" /></S>
export const IconBulb = (p) => <S {...p}><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.2 1 2.5h6c0-1.3.3-1.8 1-2.5A6 6 0 0 0 12 3z" /></S>
export const IconTrophy = (p) => <S {...p}><path d="M8 4h8v4a4 4 0 0 1-8 0z" /><path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3" /><path d="M10 15h4M9 20h6M12 15v5" /></S>
export const IconBook = (p) => <S {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></S>
export const IconClose = (p) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>
export const IconPin = (p) => <S {...p}><path d="M12 17v5" /><path d="M9 3h6l-1 6 3 3H7l3-3z" /></S>
export const IconCheck = (p) => <S {...p}><path d="M20 6L9 17l-5-5" /></S>
export const IconDot = (p) => <S {...p}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></S>
export const IconReply = (p) => <S {...p}><path d="M9 17l-5-5 5-5" /><path d="M4 12h11a5 5 0 0 1 5 5v2" /></S>
export const IconTrash = (p) => <S {...p}><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" /></S>
export const IconCommunity = (p) => <S {...p}><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6a3 3 0 0 1 0 5.5" /><path d="M17 14.5a5.5 5.5 0 0 1 3.5 4.5" /></S>
export const IconImage = (p) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.6" /><path d="M4 17l4.5-4.5 3 3L15 12l5 5" /></S>
export const IconPaperclip = (p) => <S {...p}><path d="M20 11l-8.5 8.5a4.5 4.5 0 0 1-6.4-6.4L13 4.9a3 3 0 0 1 4.3 4.3l-8.5 8.5a1.5 1.5 0 0 1-2.1-2.1L14.5 8" /></S>
export const IconBell = (p) => <S {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></S>
export const IconFile = (p) => <S {...p}><path d="M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9z" /><path d="M13 3v6h6" /></S>
export const IconUser = (p) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0 1 14 0" /></S>
export const IconGear = (p) => <S {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" /></S>
