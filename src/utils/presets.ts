import { MasteringParams, normalizeMasteringParams } from '../hooks/useAudioEngine';

export interface Preset {
  id: string;
  name: string;
  params: MasteringParams;
  isCustom?: boolean;
}

const presetParams = (params: Partial<MasteringParams>): MasteringParams => normalizeMasteringParams(params);

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: 'default',
    name: 'Flat / Default',
    params: presetParams({})
  },
  {
    id: 'clean-streaming-master',
    name: 'Clean Streaming Master',
    params: presetParams({
      inputGain: 0,
      eqLow: 0.8,
      eqMid: -0.4,
      eqHigh: 1.0,
      compThreshold: -14,
      compRatio: 2,
      makeupGain: 1.5,
      saturationDrive: 2,
      saturationMix: 0.05,
      softClipperAmount: 0.08,
      softClipperTrim: -0.5,
      outputGain: 0,
      limiterCeiling: -1,
    })
  },
  {
    id: 'aibry-trapmetal-loud',
    name: 'AIBRY Trapmetal Loud',
    params: presetParams({
      inputGain: 1,
      eqLow: 1.5,
      eqMid: -1,
      eqHigh: 1.5,
      compThreshold: -20,
      compRatio: 3,
      makeupGain: 3,
      saturationDrive: 6,
      saturationMix: 0.18,
      softClipperAmount: 0.35,
      softClipperTrim: -0.8,
      outputGain: 1,
      limiterCeiling: -0.5,
    })
  },
  {
    id: 'dark-cinematic-master',
    name: 'Dark Cinematic Master',
    params: presetParams({
      inputGain: 0,
      eqLow: 1.2,
      eqMid: -0.7,
      eqHigh: -0.3,
      compThreshold: -13,
      compRatio: 1.7,
      makeupGain: 1,
      reverbDecay: 2.2,
      reverbMix: 0.06,
      saturationDrive: 3,
      saturationMix: 0.08,
      softClipperAmount: 0.12,
      softClipperTrim: -0.3,
      outputGain: 0,
      limiterCeiling: -1,
    })
  },
  {
    id: 'raw-demo-polish',
    name: 'Raw Demo Polish',
    params: presetParams({
      inputGain: 0,
      eqLow: 0.5,
      eqMid: -0.5,
      eqHigh: 0.8,
      compThreshold: -10,
      compRatio: 1.5,
      makeupGain: 1,
      saturationDrive: 1.5,
      saturationMix: 0.04,
      softClipperAmount: 0.05,
      softClipperTrim: 0,
      outputGain: 0,
      limiterCeiling: -1,
    })
  },
  {
    id: 'vocal-forward-master',
    name: 'Vocal Forward Master',
    params: presetParams({
      inputGain: 0,
      eqLow: -0.4,
      eqMid: 1.2,
      eqHigh: 1.2,
      compThreshold: -15,
      compRatio: 2.2,
      makeupGain: 1.8,
      saturationDrive: 2.5,
      saturationMix: 0.06,
      softClipperAmount: 0.1,
      softClipperTrim: -0.4,
      outputGain: 0,
      limiterCeiling: -1,
    })
  },
  {
    id: 'punchy-bass',
    name: 'Punchy Bass',
    params: presetParams({
      eqLow: 1.8,
      eqMid: -0.5,
      eqHigh: 1,
      compThreshold: -14,
      compRatio: 2.5,
      makeupGain: 1.5,
      saturationDrive: 3,
      saturationMix: 0.1,
      softClipperAmount: 0.15,
      softClipperTrim: -0.4,
      limiterCeiling: -1,
    })
  },
  {
    id: 'heavy-metal',
    name: 'Heavy Metal',
    params: presetParams({
      eqLow: 1.5,
      eqMid: -1,
      eqHigh: 2,
      compThreshold: -18,
      compRatio: 3,
      makeupGain: 3,
      saturationDrive: 5,
      saturationMix: 0.15,
      softClipperAmount: 0.22,
      softClipperTrim: -0.7,
      limiterCeiling: -0.7,
    })
  },
  {
    id: 'deep-808-drop',
    name: 'Deep 808 Drop',
    params: presetParams({
      eqLow: 2.5,
      eqMid: -0.8,
      eqHigh: 0.5,
      compThreshold: -18,
      compRatio: 3.5,
      makeupGain: 3,
      saturationDrive: 6,
      saturationMix: 0.18,
      softClipperAmount: 0.28,
      softClipperTrim: -0.8,
      limiterCeiling: -0.7,
    })
  }
];
