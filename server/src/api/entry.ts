import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when `moduleUrl` is the process entry (`tsx src/api/server.ts`), false when merely imported (tests). */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  const norm = (p: string) => {
    const n = p.replace(/\\/g, '/').replace(/\.(ts|js|mjs|cjs|mts)$/i, '');
    return process.platform === 'win32' ? n.toLowerCase() : n;
  };
  try {
    const target = argv1.startsWith('file:') ? fileURLToPath(argv1) : resolve(argv1);
    return norm(fileURLToPath(moduleUrl)) === norm(target);
  } catch {
    return false;
  }
}
