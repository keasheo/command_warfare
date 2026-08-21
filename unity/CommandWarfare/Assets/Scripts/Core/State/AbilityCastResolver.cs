using System;
using System.Collections.Generic;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of castAbility + activateEvade from play/shared/game.ts (common effects).</summary>
    public static class AbilityCastResolver
    {
        public readonly struct CastResult
        {
            public bool Ok { get; }
            public string Error { get; }
            public string Log { get; }

            public static CastResult Success(string log) => new(true, null, log);
            public static CastResult Fail(string error) => new(false, error, null);

            CastResult(bool ok, string error, string log)
            {
                Ok = ok;
                Error = error;
                Log = log;
            }
        }

        public static CastResult TryActivateEvade(GameState state, UnitToken unit)
        {
            if (state.Phase != Phase.Play)
                return CastResult.Fail("Not play phase.");
            if (state.ActiveSeat == null || unit.Seat != state.ActiveSeat)
                return CastResult.Fail("Not your unit.");
            if (unit.EvadeActive)
                return CastResult.Fail("Evade already active on this unit.");
            if (unit.Kind == UnitKind.Commander)
                return CastResult.Fail("Commanders cannot Evade.");

            var terrain = TerrainAt(state, unit);
            if (TerrainCombatRules.DesertBlocksEvade(terrain))
                return CastResult.Fail("Cannot Evade while in Desert.");

            if (!HasEvadeCapability(unit))
                return CastResult.Fail("Unit cannot Evade.");

            var officer = CompanyActivation.FindOfficerForUnit(state, unit);
            if (officer == null)
                return CastResult.Fail("Company officer not found.");

            var spend = PoolSpending.TrySpendCompanyAp(state, officer.Id, 1);
            if (!spend.Ok) return CastResult.Fail(spend.Error);

            unit.EvadeActive = true;
            return CastResult.Success(
                $"{unit.Seat} spends 1 Company AP — {unit.CardName} activates Evade.");
        }

        public static CastResult TryCastAbility(
            GameState state,
            UnitToken caster,
            string abilityName,
            UnitToken target,
            AbilityDatabase abilities)
        {
            if (state.Phase != Phase.Play)
                return CastResult.Fail("Not play phase.");
            if (state.ActiveSeat == null || caster.Seat != state.ActiveSeat)
                return CastResult.Fail("Not your turn.");

            if (caster.NullPulsed)
                return CastResult.Fail("Null Pulse: cannot cast actives this round.");

            if (!UnitHasAbility(caster, abilityName))
                return CastResult.Fail($"{caster.CardName} does not have {abilityName}.");

            var def = abilities?.FindByName(abilityName);
            if (def == null)
                return CastResult.Fail($"Unknown ability '{abilityName}'.");

            var abilityDef = ToAbilityDef(def);
            if (!AbilityCast.CasterMayUse(abilityDef, caster.Kind))
                return CastResult.Fail($"{abilityName} is not legal for a {caster.Kind}.");

            if (AbilityCast.IsUltimate(abilityDef) && caster.UltimateUsed)
                return CastResult.Fail("Ultimate already used.");

            if (def.cooldown > 0 &&
                caster.AbilityReadyRound != null &&
                caster.AbilityReadyRound.TryGetValue(abilityName, out var ready) &&
                state.Round < ready)
                return CastResult.Fail($"{abilityName} is on cooldown until round {ready}.");

            var spendSpec = AbilityCast.SpendForCaster(abilityDef, caster.Kind);
            if (spendSpec.HasError)
                return CastResult.Fail(spendSpec.Error);

            var officerId = ResolveOfficerId(state, caster);
            if (!TrySpendPool(state, caster.Seat, officerId, spendSpec, out var spendError))
                return CastResult.Fail(spendError);

            var effectName = AbilityAliasMap.ResolveEffectName(abilityName);
            var result = ApplyEffect(state, caster, target, effectName, officerId);
            if (result.Ok)
            {
                if (AbilityCast.IsUltimate(abilityDef))
                    caster.UltimateUsed = true;
                if (def.cooldown > 0)
                {
                    caster.AbilityReadyRound ??= new System.Collections.Generic.Dictionary<string, int>();
                    caster.AbilityReadyRound[abilityName] = state.Round + def.cooldown;
                }
            }
            return result;
        }

        static CastResult ApplyEffect(
            GameState state,
            UnitToken caster,
            UnitToken target,
            string effectName,
            string officerId)
        {
            switch (effectName.ToLowerInvariant())
            {
                case "heal":
                case "medic":
                case "repair":
                    return ApplyHeal(state, caster, target, 2);
                case "forge mend":
                    return ApplyTypedHeal(state, caster, 1, dwarfOrSiege: true);
                case "repair rites":
                    return ApplyTypedHeal(state, caster, 3, constructOrSiege: true);
                case "rebuild protocol":
                    return ApplyHeal(state, caster, target, 3);
                case "harden order":
                    return ApplyHardenOrder(state, caster, target);
                case "rally":
                    return ApplyRally(state, officerId);
                case "overdrive":
                    return ApplyTempDamage(state, caster, target, 1);
                case "counterattack":
                    return ApplyCounterattackBuff(state, caster, target);
                case "howl":
                    return ApplyFearAura(state, caster, 1);
                case "withering gaze":
                    return ApplyFearTarget(state, caster, target);
                case "mass fear":
                    return ApplyMassFear(state, caster);
                case "snare":
                case "serpent coil":
                    return ApplyRootFoe(state, caster, 3, "Rooted");
                case "bone prison":
                    return ApplyRootFoe(state, caster, 3, "Rooted (cannot attack this round)", bonePrison: true);
                case "entangling roots":
                    return ApplyRootFoe(state, caster, 4, "Rooted (−1 Move)", tempMove: -1);
                case "shadow orb":
                    return ApplyShadowOrb(state, caster);
                case "focused assault":
                    return ApplyAssaultMark(state, caster, target);
                case "spectral strike":
                    return ApplySpectralStrike(state, caster, target);
                case "null pulse":
                    return ApplyNullPulse(state, caster, target);
                case "poison tide":
                    return ApplyPoisonTide(state, caster);
                case "tribal convergence":
                    return ApplyRaceTempDamage(state, caster, "Beastfolk", 1);
                case "prime protocol":
                    return ApplyRaceTempDamage(state, caster, "Construct", 2);
                case "void torment":
                    return ApplyVoidTorment(state, caster);
                case "tyrant's command":
                    return ApplyRaceBuff(state, caster, "Dragon", tempDamage: 2, harden: 1);
                case "korrik's stand":
                    return ApplyAlliesInCr(state, caster, tempDamage: 1, harden: 2, unyielding: true);
                case "realmward unity":
                    return ApplyAlliesInCr(state, caster, tempMove: 1, harden: 1);
                case "iron covenant charge":
                    return ApplyKeywordBuff(state, caster, "Infantry", tempDamage: 2);
                case "fenbrood drum":
                    return ApplyRaceBuff(state, caster, "Lizardmen", tempMove: 1);
                case "still host rise":
                    return ApplyRaceBuff(state, caster, "Undead", tempDamage: 1, fearless: true);
                case "crypt discipline":
                    return ApplyRaceBuff(state, caster, "Undead", fearless: true);
                case "directive tempo":
                    return ApplyRaceBuff(state, caster, "Construct", tempMove: 1);
                case "summit currents":
                    return ApplyKeywordBuff(state, caster, "Amphibious", tempMove: 1);
                case "arc discharge":
                case "marshal's shot":
                    return ApplyRangedStrike(state, caster, target, 6, 2, fear: false);
                case "hellspark":
                    return ApplyRangedStrike(state, caster, target, 4, 2, fear: true);
                case "wyrm lash":
                    return ApplyRangedStrike(state, caster, target, 4, 2, fear: false);
                case "anvil strike":
                    return ApplyRangedStrike(state, caster, target, 3, 2, fear: false);
                case "rootweave surge":
                    return ApplyRootweave(state, caster);
                case "alpha rush":
                    return ApplyAlphaRush(state, caster, target);
                case "spear thrust":
                    return ApplyRangedStrike(state, caster, target, 3, 2, fear: false);
                case "siege barrage":
                    return ApplySiegeBarrage(state, caster);
                case "basilisk glare":
                case "grave bind":
                    return ApplyRootFoe(state, caster, 3, "Rooted");
                case "moonbind":
                    return ApplyMoonbind(state, caster, target);
                case "kindred roar":
                    return ApplyRaceBuff(state, caster, "Dragon", tempDamage: 1, harden: 1);
                case "eclipse of fear":
                    return ApplyFearAura(state, caster, caster.CommandRadius ?? 6, damagePenalty: true);
                case "alpha howl":
                    return ApplyFearAura(state, caster, caster.CommandRadius ?? 6);
                case "regenerative surge":
                    return ApplyRegenerativeSurge(state, caster);
                case "pack reform":
                    return ApplyPackReform(state, caster);
                case "tactical withdrawal":
                    return ApplyTacticalWithdrawal(state, caster, target);
                case "death march":
                    return ApplyArmyBuff(state, caster, tempMove: 1, clearSlowIfUndead: true);
                case "brood call":
                    return ApplyArmyBuff(state, caster, tempMove: 1, tempDamage: 1);
                case "anvil advance":
                    return ApplyArmyBuff(state, caster, tempMove: 1, harden: 1);
                case "beastmaster's call":
                    return ApplyArmyBuff(state, caster, tempMove: 1);
                case "pack hunt":
                case "cannon drill":
                    return ApplyArmyBuff(state, caster, tempDamage: 1);
                case "hold the line":
                case "sealant coat":
                case "shield brotherhood":
                    return ApplyArmyBuff(state, caster, harden: 1);
                case "scale ward":
                    return ApplyArmyBuff(state, caster, harden: 2);
                case "wild rush":
                    return ApplyArmyBuff(state, caster, tempMove: 1, tempDamage: 1);
                case "fortify position":
                case "fortify works":
                case "stoneworks":
                case "grave fortify":
                    return ApplyFortify(state, caster, target);
                case "beast banner":
                    return ApplyCompanyInCr(state, caster, tempMove: 1, note: "Beast Banner");
                case "matriarch's protection":
                    return ApplyCompanyInCr(state, caster, harden: 1, note: "Matriarch's Protection");
                default:
                    return CastResult.Fail($"Effect '{effectName}' not implemented in Unity skirmish yet.");
            }
        }

        static CastResult ApplyHeal(GameState state, UnitToken caster, UnitToken target, int amount)
        {
            var ally = ResolveHealTarget(state, caster, target);
            if (ally == null)
                return CastResult.Fail("No valid heal target.");

            if (ally.ToughnessCurrent == null || ally.Toughness == null)
                return CastResult.Fail("Target has no Toughness.");

            if (ally.ToughnessCurrent >= ally.Toughness)
                return CastResult.Fail("Target is already at full Toughness.");

            if (!InHealRange(state, caster, ally))
                return CastResult.Fail("Target out of range.");

            var next = Math.Min(ally.Toughness.Value, ally.ToughnessCurrent.Value + amount);
            ally.ToughnessCurrent = next;
            return CastResult.Success(
                $"Healed {ally.CardName} to {next}/{ally.Toughness}.");
        }

        static CastResult ApplyHardenOrder(GameState state, UnitToken caster, UnitToken target)
        {
            var ally = ResolveCompanyTarget(state, caster, target);
            if (ally == null)
                return CastResult.Fail("Choose a friendly unit in this company.");
            if (!InHealRange(state, caster, ally))
                return CastResult.Fail("Target out of range.");

            ally.Harden = Math.Max(ally.Harden, 1);
            return CastResult.Success($"{ally.CardName} gains Harden 1.");
        }

        static CastResult ApplyRally(GameState state, string officerId)
        {
            if (string.IsNullOrEmpty(officerId))
                return CastResult.Fail("No officer company to Rally.");

            if (!state.CompanyPools.TryGetValue(officerId, out var pool))
                return CastResult.Fail("No company pool.");

            pool.Ap = Math.Min(pool.ApMax, pool.Ap + 1);
            state.CompanyPools[officerId] = pool;
            return CastResult.Success($"Granted +1 Company AP ({pool.Ap}/{pool.ApMax}).");
        }

        static CastResult ApplyTempDamage(GameState state, UnitToken caster, UnitToken target, int amount)
        {
            var ally = ResolveCompanyTarget(state, caster, target) ?? ResolveHealTarget(state, caster, target);
            if (ally == null)
                ally = target != null && target.Seat == caster.Seat ? target : null;
            if (ally == null)
                return CastResult.Fail("Choose a friendly ally.");
            ally.TempDamage += amount;
            return CastResult.Success($"{ally.CardName} gains +{amount} Damage.");
        }

        static CastResult ApplyCounterattackBuff(GameState state, UnitToken caster, UnitToken target)
        {
            var ally = ResolveCompanyTarget(state, caster, target);
            if (ally == null)
                ally = target != null && target.Seat == caster.Seat ? target : caster;
            ally.Counterattack = true;
            return CastResult.Success($"{ally.CardName} may Counterattack when struck.");
        }

        static CastResult ApplyFearAura(GameState state, UnitToken caster, int radius, bool damagePenalty = false)
        {
            var feared = 0;
            var origin = new HexCoord(caster.Col, caster.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat == caster.Seat) continue;
                if (!StatusEffects.CanGainFear(u)) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > radius) continue;
                u.Fear = true;
                if (damagePenalty) u.TempDamage = Math.Max(u.TempDamage - 1, -1);
                feared++;
            }
            return CastResult.Success($"Enemies in range gain Fear ({feared} affected).");
        }

        static CastResult ApplyFearTarget(GameState state, UnitToken caster, UnitToken target)
        {
            if (target == null || target.Seat == caster.Seat)
                return CastResult.Fail("Choose an enemy target.");
            if (!StatusEffects.CanGainFear(target))
                return CastResult.Fail("Target is Fearless.");
            target.Fear = true;
            return CastResult.Success($"{target.CardName} gains Fear.");
        }

        static CastResult ApplyMassFear(GameState state, UnitToken caster)
        {
            var feared = 0;
            foreach (var foe in state.Units)
            {
                if (foe.Seat == caster.Seat) continue;
                if (!StatusEffects.CanGainFear(foe)) continue;
                var nearAlly = false;
                foreach (var ally in state.Units)
                {
                    if (ally.Seat != caster.Seat) continue;
                    if (HexMath.Distance(new HexCoord(ally.Col, ally.Row), new HexCoord(foe.Col, foe.Row)) == 1)
                    {
                        nearAlly = true;
                        break;
                    }
                }
                if (!nearAlly) continue;
                foe.Fear = true;
                feared++;
            }
            return CastResult.Success($"Enemies near allies gain Fear ({feared} affected).");
        }

        static CastResult ApplyRootFoe(GameState state, UnitToken caster, int radius, string note, int tempMove = 0, bool bonePrison = false)
        {
            var foe = WeakestFoeInRange(state, caster, radius);
            if (foe == null)
                return CastResult.Success($"{note}: no enemy in range.");
            foe.Rooted = true;
            if (bonePrison) foe.BonePrisoned = true;
            if (tempMove < 0)
                foe.TempMove = Math.Min(foe.TempMove, tempMove);
            return CastResult.Success($"{foe.CardName} is {note}.");
        }

        static CastResult ApplyShadowOrb(GameState state, UnitToken caster)
        {
            var foe = WeakestFoeInRange(state, caster, 6);
            if (foe == null)
                return CastResult.Success("Shadow Orb: no enemy in range.");
            ApplyDirectDamage(state, foe, 2);
            if ((foe.ToughnessCurrent ?? 0) > 0)
            {
                foe.Slow = true;
                return CastResult.Success($"{foe.CardName} takes 2 damage and gains Slow.");
            }
            return CastResult.Success($"{foe.CardName} takes 2 damage.");
        }

        static CastResult ApplyAssaultMark(GameState state, UnitToken caster, UnitToken target)
        {
            var foe = target != null && target.Seat != caster.Seat ? target : WeakestFoeInRange(state, caster, 8);
            if (foe == null)
                return CastResult.Success("Focused Assault: no enemy in range.");
            foe.AssaultMarked = true;
            return CastResult.Success($"{foe.CardName} is marked for Focused Assault (+1 Damage vs it).");
        }

        static CastResult ApplySpectralStrike(GameState state, UnitToken caster, UnitToken target)
        {
            UnitToken chosen = null;
            if (target != null && target.Seat == caster.Seat &&
                string.Equals(target.Race, "Undead", StringComparison.OrdinalIgnoreCase))
                chosen = target;
            if (chosen == null)
            {
                foreach (var u in state.Units)
                {
                    if (u.Seat != caster.Seat) continue;
                    if (!string.Equals(u.Race, "Undead", StringComparison.OrdinalIgnoreCase)) continue;
                    if (chosen == null ||
                        CombatDamage.EffectiveDamage(u) > CombatDamage.EffectiveDamage(chosen) ||
                        (CombatDamage.EffectiveDamage(u) == CombatDamage.EffectiveDamage(chosen) &&
                         (u.ToughnessCurrent ?? 0) > (chosen.ToughnessCurrent ?? 0)))
                        chosen = u;
                }
            }
            if (chosen == null)
                return CastResult.Success("Spectral Strike: no Undead ally in range.");
            chosen.TempDamage += 1;
            chosen.SpectralStrike = true;
            return CastResult.Success($"{chosen.CardName} gains +1 Damage and ignores Defender on its next attack.");
        }

        static CastResult ApplyNullPulse(GameState state, UnitToken caster, UnitToken target)
        {
            var foe = target != null && target.Seat != caster.Seat ? target : WeakestFoeInRange(state, caster, 8);
            if (foe == null)
                return CastResult.Success("Null Pulse: no enemy in range.");
            foe.NullPulsed = true;
            return CastResult.Success($"{foe.CardName} cannot cast actives until round refresh.");
        }

        static CastResult ApplyPoisonTide(GameState state, UnitToken caster)
        {
            UnitToken cmd = caster.Kind == UnitKind.Commander ? caster : null;
            if (cmd == null)
            {
                foreach (var u in state.Units)
                    if (u.Seat == caster.Seat && u.Kind == UnitKind.Commander) { cmd = u; break; }
            }
            if (cmd == null)
                return CastResult.Success("Poison Tide: no commander.");
            var rad = cmd.CommandRadius ?? 0;
            var origin = new HexCoord(cmd.Col, cmd.Row);
            var victims = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Seat == caster.Seat) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > rad) continue;
                victims.Add(u);
            }
            victims.Sort((a, b) => (a.ToughnessCurrent ?? 0).CompareTo(b.ToughnessCurrent ?? 0));
            var n = Math.Min(3, victims.Count);
            for (var i = 0; i < n; i++)
                victims[i].PoisonTokens = Math.Min(1, victims[i].PoisonTokens + 1);
            return CastResult.Success($"Poison Tide: {n} enemy/enemies gain Poison.");
        }

        static CastResult ApplyRaceTempDamage(GameState state, UnitToken caster, string race, int amount)
        {
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                if (!string.Equals(u.Race, race, StringComparison.OrdinalIgnoreCase) &&
                    !CombatKeywords.HasUnitAbility(u, race))
                    continue;
                u.TempDamage += amount;
                hit++;
            }
            return CastResult.Success($"{hit} {race} ally/allies gain +{amount} Damage.");
        }

        static CastResult ApplyVoidTorment(GameState state, UnitToken caster)
        {
            var hit = 0;
            var survivors = 0;
            foreach (var u in new List<UnitToken>(state.Units))
            {
                if (u.Seat == caster.Seat || u.Kind == UnitKind.Commander) continue;
                if (u.ToughnessCurrent == null) continue;
                ApplyDirectDamage(state, u, 2);
                hit++;
                if ((u.ToughnessCurrent ?? 0) > 0)
                {
                    if (StatusEffects.CanGainFear(u)) u.Fear = true;
                    u.Slow = true;
                    survivors++;
                }
            }
            return CastResult.Success($"Void Torment: {hit} enemies take 2 damage; {survivors} survivor(s) gain Fear and Slow.");
        }

        static CastResult ApplyRaceBuff(
            GameState state,
            UnitToken caster,
            string race,
            int tempDamage = 0,
            int tempMove = 0,
            int harden = 0,
            bool fearless = false)
        {
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                var match = string.Equals(u.Race, race, StringComparison.OrdinalIgnoreCase) ||
                            (race == "Lizardmen" && string.Equals(u.Race, "Lizardman", StringComparison.OrdinalIgnoreCase)) ||
                            CombatKeywords.HasUnitAbility(u, race);
                if (!match) continue;
                u.TempDamage += tempDamage;
                GrantTempMove(u, tempMove);
                u.Harden += harden;
                if (fearless) u.TempFearless = true;
                hit++;
            }
            return CastResult.Success($"{hit} {race} ally/allies buffed.");
        }

        static CastResult ApplyKeywordBuff(GameState state, UnitToken caster, string keyword, int tempDamage = 0, int tempMove = 0)
        {
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                var ok = CombatKeywords.HasUnitAbility(u, keyword) ||
                         string.Equals(u.Race, keyword, StringComparison.OrdinalIgnoreCase);
                if (!ok) continue;
                u.TempDamage += tempDamage;
                GrantTempMove(u, tempMove);
                if (string.Equals(keyword, "Infantry", StringComparison.OrdinalIgnoreCase) &&
                    tempDamage > 0 &&
                    !CombatKeywords.HasUnitAbility(u, "Charge"))
                    u.Keywords.Add("Charge");
                hit++;
            }
            return CastResult.Success($"{hit} {keyword} ally/allies buffed.");
        }

        static CastResult ApplyAlliesInCr(
            GameState state,
            UnitToken caster,
            int tempDamage = 0,
            int tempMove = 0,
            int harden = 0,
            bool unyielding = false)
        {
            var origin = new HexCoord(caster.Col, caster.Row);
            var rad = caster.CommandRadius ?? 8;
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > rad) continue;
                u.TempDamage += tempDamage;
                GrantTempMove(u, tempMove);
                u.Harden += harden;
                if (unyielding) u.Unyielding = true;
                hit++;
            }
            return CastResult.Success($"{hit} ally/allies in CR buffed.");
        }

        static CastResult ApplyRangedStrike(GameState state, UnitToken caster, UnitToken target, int range, int dmg, bool fear)
        {
            var foe = target != null && target.Seat != caster.Seat &&
                      HexMath.Distance(new HexCoord(caster.Col, caster.Row), new HexCoord(target.Col, target.Row)) <= range
                ? target
                : WeakestFoeInRange(state, caster, range);
            if (foe == null)
                return CastResult.Success("No enemy in range.");
            ApplyDirectDamage(state, foe, dmg);
            if (fear && (foe.ToughnessCurrent ?? 0) > 0 && StatusEffects.CanGainFear(foe))
                foe.Fear = true;
            return CastResult.Success($"{foe.CardName} takes {dmg} damage.");
        }

        static CastResult ApplyRootweave(GameState state, UnitToken caster)
        {
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                var nature = string.Equals(u.Race, "Elf", StringComparison.OrdinalIgnoreCase) ||
                             CombatKeywords.HasUnitAbility(u, "Nature");
                if (!nature) continue;
                if (u.ToughnessCurrent != null && u.Toughness != null)
                    u.ToughnessCurrent = Math.Min(u.Toughness.Value, u.ToughnessCurrent.Value + 2);
                GrantTempMove(u, 1);
                hit++;
            }
            return CastResult.Success($"Rootweave Surge: {hit} Nature ally/allies restored.");
        }

        static CastResult ApplyAlphaRush(GameState state, UnitToken caster, UnitToken target)
        {
            var foe = target != null && target.Seat != caster.Seat ? target : WeakestFoeInRange(state, caster, 3);
            if (foe == null)
                return CastResult.Success("Alpha Rush: no enemy in range.");
            ApplyDirectDamage(state, foe, 2);
            if ((foe.ToughnessCurrent ?? 0) <= 0)
                return CastResult.Success($"{foe.CardName} takes 2 damage.");
            var origin = new HexCoord(foe.Col, foe.Row);
            var beastAdj = false;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                if (!string.Equals(u.Race, "Beastfolk", StringComparison.OrdinalIgnoreCase) &&
                    !CombatKeywords.HasUnitAbility(u, "Beast") &&
                    !CombatKeywords.HasUnitAbility(u, "Pack"))
                    continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) == 1)
                {
                    beastAdj = true;
                    break;
                }
            }
            if (beastAdj && StatusEffects.CanGainFear(foe))
            {
                foe.Fear = true;
                return CastResult.Success($"{foe.CardName} takes 2 damage and gains Fear.");
            }
            return CastResult.Success($"{foe.CardName} takes 2 damage.");
        }

        static CastResult ApplySiegeBarrage(GameState state, UnitToken caster)
        {
            var rad = caster.CommandRadius ?? Math.Max(1, caster.Range ?? 4);
            var foes = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Seat == caster.Seat || u.Kind == UnitKind.Commander) continue;
                if (HexMath.Distance(new HexCoord(caster.Col, caster.Row), new HexCoord(u.Col, u.Row)) > rad)
                    continue;
                foes.Add(u);
            }
            foes.Sort((a, b) => (a.ToughnessCurrent ?? 0).CompareTo(b.ToughnessCurrent ?? 0));
            var n = Math.Min(2, foes.Count);
            for (var i = 0; i < n; i++)
                ApplyDirectDamage(state, foes[i], 1);
            return CastResult.Success($"Siege Barrage: {n} enemy/enemies take 1 damage.");
        }

        static CastResult ApplyMoonbind(GameState state, UnitToken caster, UnitToken target)
        {
            var foe = target != null && target.Seat != caster.Seat
                ? target
                : WeakestFoeInRange(state, caster, 4);
            if (foe == null)
                return CastResult.Success("Moonbind: no enemy in range.");
            foe.Slow = true;
            foe.TempDamage = Math.Max(foe.TempDamage - 1, -1);
            return CastResult.Success($"{foe.CardName} gains Slow and −1 Damage.");
        }

        static CastResult ApplyTypedHeal(GameState state, UnitToken caster, int amount, bool dwarfOrSiege = false, bool constructOrSiege = false)
        {
            UnitToken best = null;
            var bestRatio = 2f;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat || !IsValidHealTarget(u)) continue;
                var siege = CombatKeywords.IsSiege(u);
                var ok = dwarfOrSiege
                    ? string.Equals(u.Race, "Dwarf", StringComparison.OrdinalIgnoreCase) || siege
                    : constructOrSiege
                        ? string.Equals(u.Race, "Construct", StringComparison.OrdinalIgnoreCase) || siege
                        : true;
                if (!ok) continue;
                var ratio = (u.ToughnessCurrent ?? 0) / (float)Math.Max(1, u.Toughness ?? 1);
                if (best == null || ratio < bestRatio)
                {
                    best = u;
                    bestRatio = ratio;
                }
            }
            if (best == null)
                return CastResult.Success("No matching injured ally.");
            best.ToughnessCurrent = Math.Min(best.Toughness.Value, best.ToughnessCurrent.Value + amount);
            return CastResult.Success($"Healed {best.CardName} to {best.ToughnessCurrent}/{best.Toughness}.");
        }

        static CastResult ApplyRegenerativeSurge(GameState state, UnitToken caster)
        {
            var injured = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat || !IsValidHealTarget(u)) continue;
                injured.Add(u);
            }
            injured.Sort((a, b) =>
                ((a.ToughnessCurrent ?? 0) / (float)Math.Max(1, a.Toughness ?? 1)).CompareTo(
                    (b.ToughnessCurrent ?? 0) / (float)Math.Max(1, b.Toughness ?? 1)));
            var left = 3;
            var n = Math.Min(3, injured.Count);
            for (var i = 0; i < n && left > 0; i++)
            {
                var u = injured[i];
                var gain = Math.Min(left, Math.Min(1, u.Toughness.Value - u.ToughnessCurrent.Value));
                if (gain <= 0) continue;
                u.ToughnessCurrent += gain;
                left -= gain;
            }
            while (left > 0)
            {
                var gave = false;
                for (var i = 0; i < n && left > 0; i++)
                {
                    var u = injured[i];
                    if (u.ToughnessCurrent >= u.Toughness) continue;
                    u.ToughnessCurrent += 1;
                    left -= 1;
                    gave = true;
                }
                if (!gave) break;
            }
            return CastResult.Success($"Regenerative Surge: restored Toughness among {n} injured allies.");
        }

        static void GrantTempMove(UnitToken unit, int delta)
        {
            if (delta == 0) return;
            unit.TempMove += delta;
            unit.MoveRemaining = Math.Max(0, unit.MoveRemaining + delta);
        }

        static CastResult ApplyArmyBuff(
            GameState state,
            UnitToken caster,
            int tempDamage = 0,
            int tempMove = 0,
            int harden = 0,
            bool clearSlowIfUndead = false)
        {
            var origin = new HexCoord(caster.Col, caster.Row);
            var rad = caster.Kind == UnitKind.Unit
                ? Math.Max(0, caster.Range ?? 1)
                : caster.CommandRadius ?? 0;
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > rad) continue;
                u.TempDamage += tempDamage;
                GrantTempMove(u, tempMove);
                u.Harden += harden;
                if (clearSlowIfUndead && string.Equals(u.Race, "Undead", StringComparison.OrdinalIgnoreCase))
                    u.Slow = false;
                hit++;
            }
            return CastResult.Success($"Buffed {hit} ally unit(s) in radius.");
        }

        static CastResult ApplyFortify(GameState state, UnitToken caster, UnitToken target)
        {
            var col = target?.Col ?? caster.Col;
            var row = target?.Row ?? caster.Row;
            var key = HexMath.Key(col, row);
            state.FortifiedHexes[key] = true;
            foreach (var u in state.Units)
            {
                if (u.Col != col || u.Row != row || u.Seat != caster.Seat) continue;
                u.Harden += 1;
                return CastResult.Success($"Fortified ({col},{row}) — {u.CardName} gains Harden.");
            }
            return CastResult.Success($"Fortified ({col},{row}).");
        }

        static CastResult ApplyCompanyInCr(
            GameState state,
            UnitToken caster,
            int tempMove = 0,
            int harden = 0,
            string note = "Company buff")
        {
            if (caster.Kind != UnitKind.Commander)
                return CastResult.Fail($"{note} requires a commander.");
            var rad = caster.CommandRadius ?? 0;
            var origin = new HexCoord(caster.Col, caster.Row);
            string companyCardId = null;
            if (!string.IsNullOrEmpty(state.ActiveCompanyOfficerId))
            {
                foreach (var u in state.Units)
                {
                    if (u.Id != state.ActiveCompanyOfficerId) continue;
                    if (u.Seat == caster.Seat && u.Kind == UnitKind.Officer)
                        companyCardId = u.CardId;
                    break;
                }
            }
            if (companyCardId == null)
            {
                var best = -1;
                foreach (var off in state.Units)
                {
                    if (off.Seat != caster.Seat || off.Kind != UnitKind.Officer) continue;
                    var n = 0;
                    foreach (var u in state.Units)
                    {
                        if (u.Seat != caster.Seat || u.Kind != UnitKind.Unit) continue;
                        if (u.OfficerCardId != off.CardId) continue;
                        if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > rad) continue;
                        n++;
                    }
                    if (n > best)
                    {
                        best = n;
                        companyCardId = off.CardId;
                    }
                }
            }
            var hit = 0;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat || u.Kind != UnitKind.Unit) continue;
                if (u.OfficerCardId != companyCardId) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > rad) continue;
                GrantTempMove(u, tempMove);
                u.Harden += harden;
                hit++;
            }
            return CastResult.Success(
                harden > 0
                    ? $"{note}: Harden {harden} on {hit} unit(s) of one company in CR."
                    : $"{note}: +{tempMove} Move to {hit} unit(s) of one company in CR.");
        }

        static CastResult ApplyPackReform(GameState state, UnitToken caster)
        {
            var pack = new List<UnitToken>();
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat || u.Rooted) continue;
                if (CombatKeywords.HasUnitAbility(u, "Pack")) pack.Add(u);
            }

            int AdjacentPack(UnitToken u)
            {
                var n = 0;
                foreach (var m in pack)
                {
                    if (m.Id == u.Id) continue;
                    if (HexMath.Distance(new HexCoord(u.Col, u.Row), new HexCoord(m.Col, m.Row)) == 1)
                        n++;
                }
                return n;
            }

            pack.Sort((a, b) =>
            {
                var c = AdjacentPack(a).CompareTo(AdjacentPack(b));
                return c != 0 ? c : (a.ToughnessCurrent ?? 0).CompareTo(b.ToughnessCurrent ?? 0);
            });

            var movers = pack.Count <= 2 ? pack : pack.GetRange(0, 2);
            var moved = 0;
            foreach (var u in movers)
            {
                if (AdjacentPack(u) >= 1) continue;
                UnitToken buddy = null;
                var bestBuddy = int.MaxValue;
                foreach (var m in pack)
                {
                    if (m.Id == u.Id) continue;
                    var d = HexMath.Distance(new HexCoord(u.Col, u.Row), new HexCoord(m.Col, m.Row));
                    if (d < bestBuddy)
                    {
                        bestBuddy = d;
                        buddy = m;
                    }
                }
                if (buddy == null) continue;

                var reach = Movement.ReachableMoveHexes(
                    state, u, budgetOverride: 1, ignoreTerrainCosts: true, maxSteps: 1);
                HexCoord? best = null;
                var bestDist = HexMath.Distance(new HexCoord(u.Col, u.Row), new HexCoord(buddy.Col, buddy.Row));
                foreach (var cell in reach.Values)
                {
                    if (cell.Spent <= 0) continue;
                    var d = HexMath.Distance(new HexCoord(cell.Col, cell.Row), new HexCoord(buddy.Col, buddy.Row));
                    if (d < bestDist)
                    {
                        bestDist = d;
                        best = new HexCoord(cell.Col, cell.Row);
                    }
                }
                if (best == null) continue;
                u.Col = best.Value.Col;
                u.Row = best.Value.Row;
                moved++;
            }

            return CastResult.Success(moved > 0
                ? $"Pack Reform: repositioned {moved} Pack unit(s) toward Pack adjacency."
                : "Pack Reform: Pack units already adjacent or no legal reposition.");
        }

        static CastResult ApplyTacticalWithdrawal(GameState state, UnitToken caster, UnitToken target)
        {
            UnitToken cmd = null;
            foreach (var u in state.Units)
            {
                if (u.Seat == caster.Seat && u.Kind == UnitKind.Commander)
                {
                    cmd = u;
                    break;
                }
            }

            var ally = target != null && target.Seat == caster.Seat && !target.Rooted
                ? target
                : null;
            if (ally == null)
            {
                foreach (var u in state.Units)
                {
                    if (u.Seat != caster.Seat || u.Rooted) continue;
                    if (ally == null || (u.ToughnessCurrent ?? 0) < (ally.ToughnessCurrent ?? 0))
                        ally = u;
                }
            }

            if (ally == null || cmd == null)
                return CastResult.Success("Tactical Withdrawal: no valid ally to reposition.");

            var budget = Math.Max(1, ally.Move + ally.TempMove);
            var reach = Movement.ReachableMoveHexes(
                state, ally, budgetOverride: budget, ignoreTerrainCosts: true);
            HexCoord? best = null;
            var bestDist = HexMath.Distance(new HexCoord(ally.Col, ally.Row), new HexCoord(cmd.Col, cmd.Row));
            foreach (var cell in reach.Values)
            {
                if (cell.Spent <= 0) continue;
                var d = HexMath.Distance(new HexCoord(cell.Col, cell.Row), new HexCoord(cmd.Col, cmd.Row));
                if (d < bestDist)
                {
                    bestDist = d;
                    best = new HexCoord(cell.Col, cell.Row);
                }
            }
            if (best == null)
                return CastResult.Success("Tactical Withdrawal: no retreat path toward commander.");

            ally.Col = best.Value.Col;
            ally.Row = best.Value.Row;
            return CastResult.Success($"Tactical Withdrawal: {ally.CardName} repositioned toward {cmd.CardName}.");
        }

        static void ApplyDirectDamage(GameState state, UnitToken unit, int amount)
        {
            if (unit.ToughnessCurrent == null) return;
            unit.ToughnessCurrent = Math.Max(0, unit.ToughnessCurrent.Value - amount);
            if (unit.ToughnessCurrent <= 0)
                UnitDestruction.RemoveDead(state, unit, out _);
        }

        static UnitToken WeakestFoeInRange(GameState state, UnitToken caster, int radius)
        {
            UnitToken best = null;
            var origin = new HexCoord(caster.Col, caster.Row);
            foreach (var u in state.Units)
            {
                if (u.Seat == caster.Seat) continue;
                if (u.Kind == UnitKind.Commander && (u.ToughnessCurrent ?? 0) <= 0) continue;
                if (HexMath.Distance(origin, new HexCoord(u.Col, u.Row)) > radius) continue;
                if (best == null || (u.ToughnessCurrent ?? 0) < (best.ToughnessCurrent ?? 0))
                    best = u;
            }
            return best;
        }

        static UnitToken ResolveHealTarget(GameState state, UnitToken caster, UnitToken target)
        {
            if (target != null && target.Seat == caster.Seat && IsValidHealTarget(target))
                return target;

            UnitToken best = null;
            foreach (var u in state.Units)
            {
                if (u.Seat != caster.Seat || !IsValidHealTarget(u)) continue;
                if (!InHealRange(state, caster, u)) continue;
                if (best == null || (u.ToughnessCurrent ?? 0) < (best.ToughnessCurrent ?? 0))
                    best = u;
            }
            return best;
        }

        static UnitToken ResolveCompanyTarget(GameState state, UnitToken caster, UnitToken target)
        {
            if (target != null && target.Seat == caster.Seat && InSameCompany(state, caster, target))
                return target;

            if (caster.Kind == UnitKind.Officer) return caster;
            return null;
        }

        static bool IsValidHealTarget(UnitToken u) =>
            u.Kind != UnitKind.Commander &&
            u.ToughnessCurrent != null &&
            u.Toughness != null &&
            u.ToughnessCurrent < u.Toughness;

        static bool InHealRange(GameState state, UnitToken caster, UnitToken target)
        {
            var dist = HexMath.Distance(
                new HexCoord(caster.Col, caster.Row),
                new HexCoord(target.Col, target.Row));
            var range = caster.Kind == UnitKind.Unit
                ? Math.Max(1, caster.Range ?? 1)
                : Math.Max(0, caster.CommandRadius ?? 0);
            return dist <= range;
        }

        static bool InSameCompany(GameState state, UnitToken caster, UnitToken target)
        {
            if (caster.Kind == UnitKind.Officer)
                return target.Seat == caster.Seat &&
                       (target.Id == caster.Id || target.OfficerCardId == caster.CardId);
            var officer = CompanyActivation.FindOfficerForUnit(state, caster);
            if (officer == null) return false;
            return target.Seat == caster.Seat &&
                   (target.Id == officer.Id || target.OfficerCardId == officer.CardId);
        }

        static bool TrySpendPool(
            GameState state,
            SeatId seat,
            string officerId,
            AbilityCast.AbilitySpend spend,
            out string error)
        {
            error = null;
            switch (spend.Pool)
            {
                case AbilityCast.AbilityPool.None:
                    return true;
                case AbilityCast.AbilityPool.CommanderAp:
                {
                    var r = PoolSpending.TrySpendCommanderAp(state, seat, spend.Amount);
                    if (!r.Ok) error = r.Error;
                    return r.Ok;
                }
                case AbilityCast.AbilityPool.CommanderCc:
                {
                    var r = PoolSpending.TrySpendCommanderCc(state, seat, spend.Amount);
                    if (!r.Ok) error = r.Error;
                    return r.Ok;
                }
                case AbilityCast.AbilityPool.CompanyAp:
                {
                    var r = PoolSpending.TrySpendCompanyAp(state, officerId, spend.Amount);
                    if (!r.Ok) error = r.Error;
                    return r.Ok;
                }
                default:
                    error = "Unknown spend pool.";
                    return false;
            }
        }

        static string ResolveOfficerId(GameState state, UnitToken caster)
        {
            if (caster.Kind == UnitKind.Officer) return caster.Id;
            if (caster.Kind == UnitKind.Unit)
            {
                var officer = CompanyActivation.FindOfficerForUnit(state, caster);
                return officer?.Id ?? state.ActiveCompanyOfficerId;
            }
            return state.ActiveCompanyOfficerId;
        }

        static bool HasEvadeCapability(UnitToken unit)
        {
            if (UnitHasAbility(unit, "Evade")) return true;
            if (unit.Keywords == null) return false;
            foreach (var k in unit.Keywords)
                if (string.Equals(k, "Evade", StringComparison.OrdinalIgnoreCase))
                    return true;
            return false;
        }

        static bool UnitHasAbility(UnitToken unit, string abilityName) =>
            CombatKeywords.HasUnitAbility(unit, abilityName);

        static AbilityCast.AbilityDef ToAbilityDef(AbilityDefinition def) => new(
            def.displayName,
            def.type,
            def.cost,
            def.costAmount,
            def.costResource,
            def.usedBy);

        static TerrainKind TerrainAt(GameState state, UnitToken unit)
        {
            var key = HexMath.Key(unit.Col, unit.Row);
            return state.Terrain.TryGetValue(key, out var t) ? t : TerrainKind.Plains;
        }
    }
}
