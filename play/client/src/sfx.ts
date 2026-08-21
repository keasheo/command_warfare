/** Tiny Web Audio cues — no asset files. First user gesture unlocks playback. */

import { loadAudioSettings } from './audioSettings'

let ctx: AudioContext | null = null
let sfxGain: GainNode | null = null
const initialSfx = (() => {
  try {
    return loadAudioSettings()
  } catch {
    return { sfxEnabled: true, sfxVolume: 0.7 }
  }
})()
let sfxEnabled = initialSfx.sfxEnabled
let sfxVolume = initialSfx.sfxVolume

export function getAudioContext(): AudioContext | null {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function master(): GainNode | null {
  const ac = getAudioContext()
  if (!ac) return null
  if (!sfxGain) {
    sfxGain = ac.createGain()
    sfxGain.connect(ac.destination)
  }
  sfxGain.gain.value = sfxEnabled ? sfxVolume : 0
  return sfxGain
}

export function applySfxSettings(enabled: boolean, volume: number): void {
  sfxEnabled = enabled
  sfxVolume = Math.min(1, Math.max(0, volume))
  if (sfxGain) sfxGain.gain.value = sfxEnabled ? sfxVolume : 0
}

export function unlockSfx(): void {
  const prefs = loadAudioSettings()
  applySfxSettings(prefs.sfxEnabled, prefs.sfxVolume)
  master()
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  gain = 0.06,
  slideTo?: number,
): void {
  if (!sfxEnabled || sfxVolume <= 0) return
  const ac = getAudioContext()
  const out = master()
  if (!ac || !out) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, ac.currentTime)
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, slideTo),
      ac.currentTime + duration,
    )
  }
  const amp = gain * sfxVolume
  g.gain.setValueAtTime(amp, ac.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration)
  osc.connect(g)
  g.connect(out)
  osc.start()
  osc.stop(ac.currentTime + duration + 0.02)
}

export type SfxKind = 'hit' | 'miss' | 'kill' | 'claim' | 'contest' | 'activate' | 'vp'

export function playSfx(kind: SfxKind): void {
  switch (kind) {
    case 'hit':
      tone(220, 0.14, 'sawtooth', 0.05, 110)
      break
    case 'kill':
      tone(160, 0.22, 'sawtooth', 0.07, 70)
      tone(320, 0.18, 'square', 0.03, 90)
      break
    case 'miss':
      tone(520, 0.09, 'sine', 0.035, 280)
      break
    case 'claim':
      tone(392, 0.12, 'triangle', 0.05)
      setTimeout(() => tone(523, 0.16, 'triangle', 0.045), 90)
      break
    case 'contest':
      tone(247, 0.14, 'triangle', 0.04, 196)
      break
    case 'activate':
      tone(130, 0.16, 'sine', 0.05, 196)
      break
    case 'vp':
      tone(330, 0.12, 'triangle', 0.04)
      setTimeout(() => tone(440, 0.18, 'triangle', 0.05), 100)
      break
    default:
      break
  }
}
