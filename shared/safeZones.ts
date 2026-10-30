/** shared/safeZones.ts (new). Read by the renderer and by the UI's safe-zone overlay. To check in-app before anything real. */
export interface Insets { top: number; right: number; bottom: number; left: number }
export const SAFE_ZONES = {
  tiktok:    { w: 1080, h: 1920, insets: { top: 240, right: 150, bottom: 660, left: 60 } },
  reels:     { w: 1080, h: 1920, insets: { top: 269, right: 65,  bottom: 672, left: 65 } },
  shorts:    { w: 1080, h: 1920, insets: { top: 288, right: 192, bottom: 672, left: 60 } },
  meta_feed: { w: 1080, h: 1350, insets: { top: 54,  right: 54,  bottom: 54,  left: 54 } },
  square:    { w: 1080, h: 1080, insets: { top: 54,  right: 54,  bottom: 54,  left: 54 } },
  pinterest: { w: 1080, h: 1620, insets: { top: 80,  right: 54,  bottom: 240, left: 54 } },
} as const;
