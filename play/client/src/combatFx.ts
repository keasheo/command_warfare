import type { GameState } from '../../shared/index'

export type CombatResult = NonNullable<GameState['lastCombatResult']>

export type CombatFloat = {
  text: string
  tone: 'hit' | 'miss' | 'kill' | 'info'
}

export function combatResultKey(result: CombatResult): string {
  return [
    result.seq ?? 0,
    result.attackerId,
    result.defenderId,
    result.dice[0],
    result.dice[1],
    result.roll,
    result.dealt,
    result.killed ? 1 : 0,
  ].join(':')
}

export function combatFloats(result: CombatResult): CombatFloat[] {
  const lines: CombatFloat[] = [
    { text: `${result.dice[0]}+${result.dice[1]}=${result.roll}`, tone: 'info' },
  ]
  if (!result.hit) {
    lines.push({ text: 'MISS', tone: 'miss' })
  } else if (result.unyieldingBlocked) {
    lines.push({ text: 'UNYIELDING', tone: 'info' })
  } else if (result.killed) {
    lines.push({ text: `-${result.dealt}`, tone: 'hit' })
    lines.push({ text: 'DESTROYED', tone: 'kill' })
  } else if (result.dealt > 0) {
    lines.push({ text: `-${result.dealt}`, tone: 'hit' })
  } else {
    lines.push({ text: 'HIT 0', tone: 'info' })
  }
  if (result.poisonApplied) lines.push({ text: 'POISON', tone: 'info' })
  if (result.fearApplied) lines.push({ text: 'FEAR', tone: 'info' })
  if (result.slowApplied) lines.push({ text: 'SLOW', tone: 'info' })
  return lines
}

export const COMBAT_FX_MS = 1800
