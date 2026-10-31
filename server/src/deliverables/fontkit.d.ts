// Minimal typings for fontkit (the package ships none).

declare module 'fontkit' {
  export interface PathCommand {
    command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
    args: number[];
  }
  export interface Glyph { path: { commands: PathCommand[] } }
  export interface GlyphPosition { xAdvance: number; xOffset: number; yOffset: number }
  export interface GlyphRun { glyphs: Glyph[]; positions: GlyphPosition[]; advanceWidth: number }
  export interface FontkitFont {
    unitsPerEm: number;
    copyright: string | null;
    availableFeatures: string[];
    directory: { tables: Record<string, unknown> };
    hasGlyphForCodePoint(codePoint: number): boolean;
    layout(text: string): GlyphRun;
    getName(key: string): string | null;
  }
  export function create(buffer: Uint8Array): FontkitFont;
}
