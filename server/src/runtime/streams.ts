/** Random streams of a run, keyed by (seed, stream, day, tick): the same seed is the same market, whatever the company decides. */
export const STREAM = { company: 1, tools: 2, market: 3, idleBreak: 4, org: 5, talent: 6, hire: 7, seedTalent: 8, channels: 9, videoCut: 10, videoTempo: 11 } as const;
