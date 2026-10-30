/** The cut of an ad (video §3). Only `videoModel: 'on'` under P6.1 calls it, so nothing reaches it before. */
import type { AdCreative, Product, VideoCut, VideoTempo, VoiceOfCustomer } from '../shared.js';
import type { Rng } from '../contracts.js';

export function planCut(_input: { creative: AdCreative; product: Product; voc: VoiceOfCustomer; skill: number; tempo: VideoTempo; rng: Rng }): VideoCut {
  throw new Error('not landed');
}
