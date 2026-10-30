// Minimal typing of node:fs for the UI tests (the web tsconfig has no @types/node on purpose).
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
}
