using CommandWarfare.Core;
using CommandWarfare.Core.Combat;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;

namespace CommandWarfare.Core.State
{
    /// <summary>
    /// Whether a friendly unit can still be usefully selected this turn
    /// (activate company/commander, or take move/attack/cast while active).
    /// </summary>
    public static class UnitBattleAvailability
    {
        public enum Tone
        {
            Ready,
            Active,
            Done,
            Na,
        }

        public readonly struct Info
        {
            public bool Selectable { get; }
            public string StatusLabel { get; }
            public Tone Tone { get; }

            public Info(bool selectable, string statusLabel, Tone tone)
            {
                Selectable = selectable;
                StatusLabel = statusLabel;
                Tone = tone;
            }
        }

        public static Info Describe(
            GameState state,
            UnitToken unit,
            AbilityDatabase abilities = null)
        {
            if (state == null || unit == null)
                return new Info(false, "—", Tone.Na);
            if (state.Phase != Phase.Play || !state.ActiveSeat.HasValue)
                return new Info(false, "Not in play", Tone.Na);
            if (unit.Seat != state.ActiveSeat.Value)
                return new Info(false, "Opponent", Tone.Na);

            if (unit.Kind == UnitKind.Commander)
                return DescribeCommander(state, unit, abilities);

            return DescribeCompanyMember(state, unit, abilities);
        }

        static Info DescribeCommander(GameState state, UnitToken unit, AbilityDatabase abilities)
        {
            if (!CommanderActivation.IsCommanderActivatedThisRound(state, unit.Seat))
                return new Info(true, "Ready to activate", Tone.Ready);

            if (HasLiveActions(state, unit, abilities, companyMustBeActive: false))
                return new Info(true, "Activated · actions left", Tone.Active);

            return new Info(false, "Activated this round", Tone.Done);
        }

        static Info DescribeCompanyMember(
            GameState state, UnitToken unit, AbilityDatabase abilities)
        {
            var officer = unit.Kind == UnitKind.Officer
                ? unit
                : CompanyActivation.FindOfficerForUnit(state, unit);
            if (officer == null || officer.Kind != UnitKind.Officer)
                return new Info(false, "No officer", Tone.Na);

            if (state.ActiveCompanyOfficerId == officer.Id)
            {
                if (HasLiveActions(state, unit, abilities, companyMustBeActive: true))
                    return new Info(true, "Company active", Tone.Active);
                return new Info(true, "Company active", Tone.Active);
            }

            var roundDone = state.CompaniesActivatedThisRound != null &&
                            state.CompaniesActivatedThisRound.TryGetValue(officer.Id, out var done) &&
                            done;
            if (roundDone)
                return new Info(false, "Activated this round", Tone.Done);

            var otherThisTurn = state.CompanyActivatedThisTurn != null &&
                                state.CompanyActivatedThisTurn.TryGetValue(unit.Seat, out var other) &&
                                !string.IsNullOrEmpty(other) &&
                                other != officer.Id;
            if (otherThisTurn)
                return new Info(false, "Other company this turn", Tone.Done);

            if (state.CommanderPools == null ||
                !state.CommanderPools.TryGetValue(unit.Seat, out var cmdPool) ||
                cmdPool.Cc < GameConstants.OfficerActivateCcCost)
                return new Info(false, "Need 1 CC", Tone.Done);

            return new Info(true, "Ready to activate (−1 CC)", Tone.Ready);
        }

        /// <summary>
        /// True if this unit can still move, attack, or cast while currently activated.
        /// </summary>
        public static bool HasRemainingActions(
            GameState state,
            UnitToken unit,
            AbilityDatabase abilities = null)
        {
            if (state == null || unit == null) return false;
            if (unit.Kind == UnitKind.Commander)
            {
                if (!CommanderActivation.IsCommanderActivatedThisRound(state, unit.Seat))
                    return false;
                return HasLiveActions(state, unit, abilities, companyMustBeActive: false);
            }

            return HasLiveActions(state, unit, abilities, companyMustBeActive: true);
        }

        static bool HasLiveActions(
            GameState state,
            UnitToken unit,
            AbilityDatabase abilities,
            bool companyMustBeActive)
        {
            if (companyMustBeActive &&
                unit.Kind != UnitKind.Commander &&
                !CompanyActivation.IsUnitInActiveCompany(state, unit))
                return false;

            if (unit.MoveRemaining > 0)
                return true;

            var attacked = unit.AttackedThisTurn || unit.AttackedThisRound;
            if (!attacked &&
                (unit.Kind == UnitKind.Commander ||
                 CompanyActivation.IsUnitInActiveCompany(state, unit)))
                return true;

            return HasCastableAbility(state, unit, abilities);
        }

        static bool HasCastableAbility(
            GameState state, UnitToken unit, AbilityDatabase abilities)
        {
            if (abilities == null) return false;

            var names = new System.Collections.Generic.List<string>();
            if (unit.Abilities != null) names.AddRange(unit.Abilities);
            if (!string.IsNullOrEmpty(unit.Ultimate) && !names.Contains(unit.Ultimate))
                names.Add(unit.Ultimate);

            foreach (var name in names)
            {
                var def = abilities.FindByName(name);
                if (def == null) continue;
                var abilityDef = new AbilityCast.AbilityDef(
                    def.displayName, def.type, def.cost, def.costAmount, def.costResource, def.usedBy);
                if (AbilityCast.IsPassive(abilityDef)) continue;
                if (!AbilityCast.CasterMayUse(abilityDef, unit.Kind)) continue;

                var spend = AbilityCast.SpendForCaster(abilityDef, unit.Kind);
                if (spend.HasError) continue;

                if (spend.Pool == AbilityCast.AbilityPool.None)
                {
                    if (!unit.UltimateUsed) return true;
                    continue;
                }

                if (spend.Pool == AbilityCast.AbilityPool.CommanderAp)
                {
                    if (state.CommanderPools != null &&
                        state.CommanderPools.TryGetValue(unit.Seat, out var cp) &&
                        cp.Ap >= spend.Amount)
                        return true;
                }
                else if (spend.Pool == AbilityCast.AbilityPool.CommanderCc)
                {
                    if (state.CommanderPools != null &&
                        state.CommanderPools.TryGetValue(unit.Seat, out var cp) &&
                        cp.Cc >= spend.Amount)
                        return true;
                }
                else if (spend.Pool == AbilityCast.AbilityPool.CompanyAp)
                {
                    var officer = CompanyActivation.FindOfficerForUnit(state, unit) ??
                                  (unit.Kind == UnitKind.Officer ? unit : null);
                    if (officer != null &&
                        state.CompanyPools != null &&
                        state.CompanyPools.TryGetValue(officer.Id, out var co) &&
                        co.Ap >= spend.Amount)
                        return true;
                }
            }

            return false;
        }
    }
}
