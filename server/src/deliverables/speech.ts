/** How long a line lasts out loud (video §3.2). Measured on Hortense at Rate 1, worst error +8 %: benchmarks read this, real speech never reaches the score. */
export function estimateSpeechSec(text: string): number {
  const t = text.trim();
  const pauses = (t.match(/[,:;—–]/g) ?? []).length + (t.match(/[.!?]\s/g) ?? []).length * 1.6;
  return t.length / 20.5 + 0.22 * pauses + 0.1;
}
