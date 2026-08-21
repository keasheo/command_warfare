import { useEffect, useState } from 'react'
import {
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings as Prefs,
} from './audioSettings'
import { applySfxSettings, unlockSfx } from './sfx'
import {
  applyMusicSettings,
  currentBattleTrack,
  skipBattleTrack,
  startBattleMusic,
  subscribeBattleMusic,
} from './battleMusic'

function applyAll(next: Prefs): void {
  saveAudioSettings(next)
  applySfxSettings(next.sfxEnabled, next.sfxVolume)
  applyMusicSettings(next.musicEnabled, next.musicVolume)
  unlockSfx()
  if (next.musicEnabled) startBattleMusic()
}

export function AudioPanel({ compact = false }: { compact?: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(() => loadAudioSettings())
  const [track, setTrack] = useState(currentBattleTrack())

  useEffect(() => subscribeBattleMusic(() => setTrack(currentBattleTrack())), [])

  const patch = (partial: Partial<Prefs>) => {
    const next = { ...prefs, ...partial }
    setPrefs(next)
    applyAll(next)
  }

  return (
    <div className={compact ? 'audio-settings compact' : 'audio-settings'}>
      {!compact ? <h3 className="lobby-section-title">Audio</h3> : null}
      <label className="check-field">
        <input
          type="checkbox"
          checked={prefs.musicEnabled}
          onChange={(e) => patch({ musicEnabled: e.target.checked })}
        />
        <span>Battle music</span>
      </label>
      <label className="audio-slider-field">
        <span>Music volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(prefs.musicVolume * 100)}
          disabled={!prefs.musicEnabled}
          onChange={(e) => patch({ musicVolume: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={prefs.sfxEnabled}
          onChange={(e) => patch({ sfxEnabled: e.target.checked })}
        />
        <span>Sound effects</span>
      </label>
      <label className="audio-slider-field">
        <span>SFX volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(prefs.sfxVolume * 100)}
          disabled={!prefs.sfxEnabled}
          onChange={(e) => patch({ sfxVolume: Number(e.target.value) / 100 })}
        />
      </label>
      {prefs.musicEnabled && track ? (
        <p className="audio-now-playing muted">
          {track.title}
          {track.author ? ` — ${track.author}` : ''}
          {track.license ? ` (${track.license})` : ''}
          <button
            type="button"
            className="ghost audio-skip"
            onClick={() => {
              unlockSfx()
              skipBattleTrack()
            }}
          >
            Next
          </button>
        </p>
      ) : null}
    </div>
  )
}
