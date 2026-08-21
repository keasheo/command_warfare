using System.Collections.Generic;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Core.Util;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of blast splash + overpenetrate + trample apply from combatResolve.ts / game.ts.</summary>
    public static class CombatFollowup
    {
        public static void ApplyHitStatuses(UnitToken defender, AttackResult result)
        {
            if (result.UnyieldingBlocked)
            {
                defender.Unyielding = false;
                return;
            }
            if (!result.Hit || result.Dealt <= 0) return;
            if ((defender.ToughnessCurrent ?? 0) <= 0) return;
            if (result.PoisonApplied) defender.PoisonTokens = 1;
            if (result.FearApplied) defender.Fear = true;
            if (result.SlowApplied) defender.Slow = true;
        }

        public static string ApplyCounterattack(GameState state, UnitToken attacker, UnitToken defender, AttackResult result)
        {
            if (!result.Hit || result.Dealt <= 0 || result.UnyieldingBlocked) return null;
            if (!defender.Counterattack) return null;
            if ((defender.ToughnessCurrent ?? 0) <= 0) return null;
            if ((attacker.ToughnessCurrent ?? 0) <= 0) return null;

            var back = System.Math.Max(1, CombatDamage.EffectiveDamage(defender));
            attacker.ToughnessCurrent = System.Math.Max(0, (attacker.ToughnessCurrent ?? 0) - back);
            defender.Counterattack = false;
            if ((attacker.ToughnessCurrent ?? 0) <= 0)
                RemoveDead(state, attacker);
            return $"{defender.CardName} Counterattacks {attacker.CardName} for {back}";
        }

        public static string ApplyBlastSplash(
            GameState state,
            UnitToken attacker,
            UnitToken primary,
            SeededRng rng,
            CardDatabase cards)
        {
            if (!CombatKeywords.HasBlast(attacker)) return null;
            var hits = 0;
            var killed = 0;
            var primaryHex = new HexCoord(primary.Col, primary.Row);
            var splash = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Id == primary.Id || u.Id == attacker.Id) continue;
                if (u.Seat == attacker.Seat) continue;
                if ((u.ToughnessCurrent ?? 0) <= 0) continue;
                if (HexMath.Distance(primaryHex, new HexCoord(u.Col, u.Row)) != 1) continue;
                splash.Add(u);
            }

            foreach (var target in splash)
            {
                var ctx = BuildContext(state, attacker, target, cards, strikeOverride: null);
                AttackResult splashResult;
                try
                {
                    splashResult = CombatResolve.ResolveAttack(ctx, rng);
                }
                catch (System.InvalidOperationException)
                {
                    continue;
                }

                hits++;
                if (!splashResult.Hit || splashResult.UnyieldingBlocked) continue;
                target.ToughnessCurrent = (target.ToughnessCurrent ?? 0) - splashResult.Dealt;
                ApplyHitStatuses(target, splashResult);
                if (splashResult.Killed || (target.ToughnessCurrent ?? 0) <= 0)
                {
                    RemoveDead(state, target);
                    killed++;
                }
            }

            if (hits == 0) return null;
            return $"Blast splash {hits} hexes ({killed} killed)";
        }

        public static string ApplyOverpenetrate(
            GameState state,
            UnitToken attacker,
            UnitToken primary,
            int leftover,
            SeededRng rng,
            CardDatabase cards)
        {
            if (leftover <= 0 || !CombatKeywords.HasOverpenetrate(attacker)) return null;
            var origin = new HexCoord(attacker.Col, attacker.Row);
            var through = new HexCoord(primary.Col, primary.Row);
            var dmg = leftover;
            var chained = 0;

            for (var step = 0; step < state.BoardSize && dmg > 0; step++)
            {
                var behind = HexMath.HexBehind(origin, through);
                if (!behind.HasValue || !HexMath.InBounds(behind.Value, state.BoardSize)) break;
                var occ = OccupantAt(state, behind.Value);
                if (occ == null)
                {
                    through = behind.Value;
                    continue;
                }
                if (occ.Seat == attacker.Seat || occ.Kind == UnitKind.Commander) break;
                var hpBefore = occ.ToughnessCurrent ?? 0;
                if (hpBefore <= 0)
                {
                    through = behind.Value;
                    continue;
                }

                var ctx = BuildContext(state, attacker, occ, cards, dmg);
                AttackResult splash;
                try
                {
                    splash = CombatResolve.ResolveAttack(ctx, rng);
                }
                catch (System.InvalidOperationException)
                {
                    break;
                }

                chained++;
                if (!splash.Hit || splash.Dealt <= 0) break;
                occ.ToughnessCurrent = hpBefore - splash.Dealt;
                ApplyHitStatuses(occ, splash);
                if (!splash.Killed && (occ.ToughnessCurrent ?? 0) > 0) break;
                RemoveDead(state, occ);
                dmg = CombatDamage.TrampleLeftoverDamage(dmg, hpBefore);
                through = new HexCoord(occ.Col, occ.Row);
            }

            return chained > 0 ? $"Overpenetrate chained {chained}" : null;
        }

        public static void OfferTrample(GameState state, UnitToken attacker, UnitToken defender, AttackResult result)
        {
            if (!result.TrampleEligible) return;
            state.PendingTrample = new PendingTrample
            {
                AttackerId = attacker.Id,
                DestCol = defender.Col,
                DestRow = defender.Row,
                LeftoverDamage = result.TrampleLeftover,
            };
        }

        public static bool ContinueTrample(GameState state, out string log)
        {
            log = null;
            var pending = state.PendingTrample;
            if (pending == null) return false;
            UnitToken attacker = null;
            foreach (var u in state.Units)
            {
                if (u.Id == pending.AttackerId) { attacker = u; break; }
            }
            if (attacker == null)
            {
                state.PendingTrample = null;
                return false;
            }

            var dest = new HexCoord(pending.DestCol, pending.DestRow);
            if (!HexMath.InBounds(dest, state.BoardSize) || OccupantAt(state, dest) != null)
            {
                log = "Trample destination blocked.";
                state.PendingTrample = null;
                return false;
            }

            attacker.Col = dest.Col;
            attacker.Row = dest.Row;
            attacker.TrampleLeftoverDamage = pending.LeftoverDamage;
            state.PendingTrample = null;
            log = pending.LeftoverDamage > 0
                ? $"{attacker.CardName} Tramples into ({dest.Col},{dest.Row}) with {pending.LeftoverDamage} leftover."
                : $"{attacker.CardName} Tramples into ({dest.Col},{dest.Row}).";
            return true;
        }

        public static bool DeclineTrample(GameState state, out string log)
        {
            log = null;
            if (state.PendingTrample == null) return false;
            state.PendingTrample = null;
            log = "Declines Trample.";
            return true;
        }

        static UnitToken OccupantAt(GameState state, HexCoord cell)
        {
            foreach (var u in state.Units)
            {
                if (u.Col == cell.Col && u.Row == cell.Row &&
                    (u.Kind == UnitKind.Commander || (u.ToughnessCurrent ?? 0) > 0))
                    return u;
            }
            return null;
        }

        static void RemoveDead(GameState state, UnitToken unit)
        {
            UnitDestruction.RemoveDead(state, unit, out _);
        }

        static AttackContext BuildContext(
            GameState state,
            UnitToken attacker,
            UnitToken defender,
            CardDatabase cards,
            int? strikeOverride)
        {
            var atkTerrain = TerrainAt(state, attacker);
            var defTerrain = TerrainAt(state, defender);
            var dist = HexMath.Distance(
                new HexCoord(attacker.Col, attacker.Row),
                new HexCoord(defender.Col, defender.Row));
            var atkCard = cards?.FindById(attacker.CardId);
            var defCard = cards?.FindById(defender.CardId);
            var hitCtx = new HitNeedContext(
                dist, atkTerrain, defTerrain,
                attackerFear: StatusEffects.UnitHasFearPenalty(attacker),
                defenderEvadeActive: defender.EvadeActive,
                attackerForestFavored: FavoredTerrain.HasForestFavored(attacker, atkCard),
                favoredTerrainHit: FavoredTerrain.GrantsHitBonus(attacker, atkCard, atkTerrain),
                flanking: false,
                formationDrill: Formation.DrillHitBonus(state, attacker, cards) > 0);
            var strikeCtx = new StrikeContext(
                attacker, defender,
                favoredTerrainDamage: FavoredTerrain.GrantsDamageBonus(attacker, atkCard, atkTerrain),
                strikeDamageOverride: strikeOverride,
                attackerTags: DamageTypes.TagsFrom(atkCard),
                defenderTags: DamageTypes.TagsFrom(defCard));
            var damageCtx = new DamageContext(
                defender, attacker,
                mountainsFavoredHarden: FavoredTerrain.GrantsHardenBonus(defender, defCard, defTerrain),
                formationGuard: Formation.GuardMitigation(state, defender, cards));
            return new AttackContext(attacker, defender, atkTerrain, defTerrain, hitCtx, strikeCtx, damageCtx, skipRangeCheck: true);
        }

        static TerrainKind TerrainAt(GameState state, UnitToken unit)
        {
            var key = HexMath.Key(unit.Col, unit.Row);
            return state.Terrain.TryGetValue(key, out var t) ? t : TerrainKind.Plains;
        }
    }
}
