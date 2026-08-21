using System;
using System.Collections.Generic;

namespace CommandWarfare.Core.Types
{
    /// <summary>Port of play/shared/types.ts UnitToken — fields added incrementally.</summary>
    [Serializable]
    public class UnitToken
    {
        public string Id;
        public SeatId Seat;
        public UnitKind Kind;
        public string CardId;
        public string CardName;
        public string Race;
        public string OfficerCardId;
        public int Col;
        public int Row;
        public int Move;
        public int MoveRemaining;
        public int? Damage;
        public int? Range;
        public int? Toughness;
        public int? ToughnessCurrent;
        public int? CommandRadius;
        public List<string> Keywords = new();
        public List<string> Abilities = new();
        public string Ultimate;
        public bool Rooted;
        public bool BonePrisoned;
        public bool Fear;
        public bool TerrorFear;
        public bool Slow;
        public bool SlowPendingClear;
        public bool TempFearless;
        public bool EvadeActive;
        public bool Unyielding;
        public int Harden;
        public int TempDamage;
        public int TempMove;
        public int? ActivationCol;
        public int? ActivationRow;
        public bool SpectralStrike;
        public bool AssaultMarked;
        public bool NullPulsed;
        public bool Counterattack;
        public int PoisonTokens;
        public int TrampleLeftoverDamage;
        public bool AttackedThisTurn;
        public bool AttackedThisRound;
        public bool FrenzyAttackPending;
        public bool HarassMovePending;
        public bool RevenantUsed;
        public bool UltimateUsed;
        public Dictionary<string, int> AbilityReadyRound = new();
        /// <summary>Promoted officer/commander — badge shows PO / PC.</summary>
        public bool Promoted;
    }
}
