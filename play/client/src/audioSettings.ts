/** Per-device music / SFX prefs (localStorage). */

export type AudioSettings = {
  musicEnabled: boolean
  sfxEnabled: boolean
  /** 0–1 */
  musicVolume: number
  /** 0–1 */
  sfxVolume: number
}

const KEY = 'cw-play-audio'

const DEFAULTS: AudioSettings = {
  musicEnabled: true,
  sfxEnabled: true,
  musicVolume: 0.32,
  sfxVolume: 0.7,
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<AudioSettings>
    return {
      musicEnabled: parsed.musicEnabled !== false,
      sfxEnabled: parsed.sfxEnabled !== false,
      musicVolume: clamp01(
        parsed.musicVolume ?? DEFAULTS.musicVolume,
      ),
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULTS.sfxVolume),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
}
