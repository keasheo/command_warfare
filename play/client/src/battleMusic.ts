/** Shuffled CC0 battle recordings from OpenGameArt. */

import { loadAudioSettings } from './audioSettings'

export type BattleTrack = {
  title: string
  author: string
  license: string
  src: string
  page: string
}

export const BATTLE_TRACKS: BattleTrack[] = [
  {
    src: '/music/jungle-battle.ogg',
    title: 'Jungle Battle Loop',
    author: 'omfgdude',
    license: 'CC0',
    page: 'https://opengameart.org/content/jungle-battle-loop',
  },
  {
    src: '/music/rpg-battle.mp3',
    title: 'RPG Battle Loop',
    author: 'iamoneabe',
    license: 'CC0',
    page: 'https://opengameart.org/content/rpg-battle-loop',
  },
  {
    src: '/music/chiptune-battle.ogg',
    title: 'Chiptune Battle Music',
    author: 'Yubatake',
    license: 'CC0',
    page: 'https://opengameart.org/content/chiptune-battle-music',
  },
]

let enabled = true
let volume = 0.32
let unlocked = false
let playing = false
let queue: BattleTrack[] = []
let queueIndex = 0
let el: HTMLAudioElement | null = null
let current: BattleTrack | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function subscribeBattleMusic(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function currentBattleTrack(): BattleTrack | null {
  return current
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

function applyElementVolume(): void {
  if (el) el.volume = enabled ? volume : 0
}

function stopElement(): void {
  if (!el) return
  el.onended = null
  el.onerror = null
  el.pause()
  el.src = ''
  el = null
}

function playAt(index: number): void {
  stopElement()
  if (!enabled || !unlocked || !playing) return
  if (queue.length === 0) queue = shuffle([...BATTLE_TRACKS])
  queueIndex = ((index % queue.length) + queue.length) % queue.length
  const track = queue[queueIndex]!
  current = track
  const audioEl = new Audio(track.src)
  audioEl.preload = 'auto'
  audioEl.loop = true
  audioEl.volume = volume
  audioEl.onerror = () => playAt(queueIndex + 1)
  el = audioEl
  notify()
  void audioEl.play().catch(() => playAt(queueIndex + 1))
}

export function applyMusicSettings(on: boolean, vol: number): void {
  enabled = on
  volume = Math.min(1, Math.max(0, vol))
  applyElementVolume()
  if (!enabled || volume <= 0) {
    stopElement()
    current = null
    playing = false
    notify()
    return
  }
  if (unlocked) startBattleMusic()
}

export function startBattleMusic(): void {
  unlocked = true
  const prefs = loadAudioSettings()
  enabled = prefs.musicEnabled
  volume = prefs.musicVolume
  if (!enabled || volume <= 0) return
  if (playing && el) {
    applyElementVolume()
    void el.play().catch(() => {})
    return
  }
  playing = true
  if (queue.length === 0) queue = shuffle([...BATTLE_TRACKS])
  playAt(queueIndex)
}

export function skipBattleTrack(): void {
  if (!playing || !enabled) return
  playAt(queueIndex + 1)
}

export function stopBattleMusic(): void {
  playing = false
  stopElement()
  current = null
  notify()
}
