import { MasteringParams } from '../hooks/useAudioEngine';

export interface Preset {
  id: string;
  name: string;
  params: MasteringParams;
  isCustom?: boolean;
}

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'default',
    name: 'Flat / Default',
    params: { eqLow: 0, eqMid: 0, eqHigh: 0, compThreshold: -12, compRatio: 1.5, makeupGain: 0, delayTime: 0.3, delayFeedback: 0.2, delayMix: 0, reverbDecay: 1.5, reverbMix: 0, saturationDrive: 1, saturationMix: 0 }
  },
  {
    id: 'punchy-bass',
    name: 'Punchy Bass',
    // Reduced EQ boost from 4.5 to 1.8 for transparency; lowered compression ratio
    params: { eqLow: 1.8, eqMid: -0.5, eqHigh: 1.0, compThreshold: -14, compRatio: 2.5, makeupGain: 1.5, delayTime: 0.3, delayFeedback: 0.2, delayMix: 0, reverbDecay: 1.2, reverbMix: 0.05, saturationDrive: 3, saturationMix: 0.1 }
  },
  {
    id: 'vocal-pop',
    name: 'Vocal Pop',
    // Tamed high-end boost from 4.0 to 1.5; lower saturation for a cleaner signal
    params: { eqLow: -0.5, eqMid: 1.0, eqHigh: 1.5, compThreshold: -16, compRatio: 2.0, makeupGain: 2, delayTime: 0.2, delayFeedback: 0.1, delayMix: 0.05, reverbDecay: 1.8, reverbMix: 0.08, saturationDrive: 2, saturationMix: 0.05 }
  },
  {
    id: 'acoustic-warmth',
    name: 'Acoustic Warmth',
    // Drastically reduced saturation mix from 0.4 to 0.1 to avoid audible distortion
    params: { eqLow: 1.2, eqMid: 0.5, eqHigh: -0.5, compThreshold: -10, compRatio: 1.5, makeupGain: 1, delayTime: 0.4, delayFeedback: 0.2, delayMix: 0.02, reverbDecay: 2.2, reverbMix: 0.1, saturationDrive: 4, saturationMix: 0.1 }
  },
  {
    id: 'heavy-glue',
    name: 'Heavy Glue',
    // Lowered compression ratio from 8 to 1.5 for a classic "glue" effect
    params: { eqLow: 0.5, eqMid: -0.2, eqHigh: 0.5, compThreshold: -20, compRatio: 1.5, makeupGain: 2.5, delayTime: 0.3, delayFeedback: 0.2, delayMix: 0, reverbDecay: 1.0, reverbMix: 0, saturationDrive: 2, saturationMix: 0.05 }
  },
  {
    id: 'heavy-metal',
    name: 'Heavy Metal',
    // Capped EQ boosts at 2.0dB; reduced saturation mix from 0.6 to 0.15
    params: { eqLow: 1.5, eqMid: -1.0, eqHigh: 2.0, compThreshold: -18, compRatio: 3.0, makeupGain: 3, delayTime: 0.1, delayFeedback: 0.1, delayMix: 0.02, reverbDecay: 1.0, reverbMix: 0.05, saturationDrive: 5, saturationMix: 0.15 }
  },
  {
    id: 'trap-metal',
    name: 'Trap Metal',
    // Lowered saturation from 0.8 to 0.25; reduced EQ boosts to prevent digital clipping
    params: { eqLow: 2.5, eqMid: -1.2, eqHigh: 1.5, compThreshold: -22, compRatio: 4.0, makeupGain: 4, delayTime: 0.125, delayFeedback: 0.2, delayMix: 0.05, reverbDecay: 1.2, reverbMix: 0.1, saturationDrive: 8, saturationMix: 0.25 }
  },
  {
    id: 'deep-808-drop',
    name: 'Deep 808 Drop',
    // Tamed extreme 8.0dB bass boost to a more manageable 3.5dB
    params: { eqLow: 3.5, eqMid: -0.8, eqHigh: 0.5, compThreshold: -18, compRatio: 3.5, makeupGain: 3, delayTime: 0.25, delayFeedback: 0.1, delayMix: 0.05, reverbDecay: 1.5, reverbMix: 0.08, saturationDrive: 6, saturationMix: 0.2 }
  }
];