using System;
using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.Terrain;
using CommandWarfare.Core.Types;

namespace CommandWarfare.Core.State
{
    /// <summary>Port of play/shared/types.ts GameState — core fields for offline skirmish.</summary>
    [Serializable]
    public class GameState
    {
        public string RoomCode = "dev";
        public int MaxPlayers = 2;
        public int BoardSize = GameConstants.BoardSize2P;
        public Phase Phase = Phase.Play;
        public SeatId? ActiveSeat = SeatId.N;
        public int Round = 1;

        public Dictionary<string, TerrainKind> Terrain = new();
        public Dictionary<string, bool> FortifiedHexes = new();
        public Dictionary<SeatId, HexCoord> Commanders = new();
        public Dictionary<SeatId, int> CommanderRadii = new();

        public List<UnitToken> Units = new();
        /// <summary>Destroyed officers/units available for reviveFromGrave.</summary>
        public List<DeathRecord> Deaths = new();
        public List<ObjectiveMarker> Objectives = new();
        public Dictionary<SeatId, int> Scores = new();
        public bool Draw;

        public string SelectedUnitId;
        public string LastCombatLog;
        public string LastActionLog;
        public DiceRollRecord LastDiceRoll;
        public SeatId? WinnerSeat;

        /// <summary>Officer unit id whose company is currently activated.</summary>
        public string ActiveCompanyOfficerId;

        public Dictionary<string, bool> CompaniesActivatedThisRound = new();
        public Dictionary<SeatId, string> CompanyActivatedThisTurn = new();
        public Dictionary<SeatId, bool> CommanderActivatedThisRound = new();
        public Dictionary<SeatId, CommanderPool> CommanderPools = new();
        public Dictionary<string, CompanyPool> CompanyPools = new();

        /// <summary>Offline deploy: seats that confirmed placement.</summary>
        public Dictionary<SeatId, bool> DeployReady = new();

        /// <summary>Offline ForceSelect: seats that confirmed battle loadout.</summary>
        public Dictionary<SeatId, bool> ForceSelectReady = new();

        /// <summary>Offline Terrain: seats that confirmed command-zone setup.</summary>
        public Dictionary<SeatId, bool> TerrainReady = new();

        /// <summary>Offline Terrain: seats that already flood-filled CR.</summary>
        public Dictionary<SeatId, bool> CommandZoneFlooded = new();

        /// <summary>Per-seat command-zone mode: "flood" | "pieces".</summary>
        public Dictionary<SeatId, string> CommandZoneModes = new();

        /// <summary>Command-zone piece hand per seat (pieces mode).</summary>
        public Dictionary<SeatId, List<TerrainQueueItem>> TerrainHands = new();

        /// <summary>Selected hand index for CR piece placement (-1 = none).</summary>
        public Dictionary<SeatId, int> PendingCrHandIndex = new();

        /// <summary>Terrain stage label (commandZone / landLarge / Medium / Small).</summary>
        public string TerrainStage = "commandZone";

        /// <summary>When true, offline skips interactive Terrain (random biome → Deploy).</summary>
        public bool RandomMap = false;

        /// <summary>Land-drop counts per seat for the current land tier.</summary>
        public Dictionary<SeatId, int> LandDropsUsed = new();

        /// <summary>Turn order during land stages (N, S for 2P).</summary>
        public List<SeatId> TerrainTurnOrder = new();

        /// <summary>Selected land piece id for placement.</summary>
        public string PendingLandPieceId;

        /// <summary>Rotation 0–5 for pending land piece.</summary>
        public int PendingLandRotation;

        /// <summary>Offline demo armies (built at ForceSelect, spawn Deploy bucket only).</summary>
        public Dictionary<SeatId, DemoArmy> OfflineArmies = new();

        /// <summary>Officer card id → Deploy / Reserve / Unused per seat.</summary>
        public Dictionary<SeatId, Dictionary<string, BattleBucket>> BattleLoadouts = new();

        /// <summary>Offline deploy queues (commander → officers → units).</summary>
        public Dictionary<SeatId, List<DeployQueueItem>> DeployQueues = new();

        /// <summary>Reserve bucket queues (off-board until revive — stored at ForceSelect lock).</summary>
        public Dictionary<SeatId, List<DeployQueueItem>> ReserveQueues = new();

        /// <summary>Selected deploy queue index per seat (-1 = none).</summary>
        public Dictionary<SeatId, int> DeployQueueIndex = new();

        public LoadoutPools LoadoutPools = LoadoutPools.Default;

        /// <summary>Offline army build race picks (N human / S opponent).</summary>
        public string NorthRace = "Human";
        public string SouthRace = "Dwarf";

        public PendingTrample PendingTrample;
        public PendingCleave PendingCleave;
    }

    [Serializable]
    public class PendingTrample
    {
        public string AttackerId;
        public int DestCol;
        public int DestRow;
        public int LeftoverDamage;
    }

    [Serializable]
    public struct CommanderPool
    {
        public int Ap;
        public int Cc;
        public int ApMax;
        public int CcMax;

        public CommanderPool(int ap, int cc, int apMax, int ccMax)
        {
            Ap = ap;
            Cc = cc;
            ApMax = apMax;
            CcMax = ccMax;
        }
    }

    [Serializable]
    public struct CompanyPool
    {
        public int Ap;
        public int ApMax;

        public CompanyPool(int ap, int apMax)
        {
            Ap = ap;
            ApMax = apMax;
        }
    }

    [Serializable]
    public class ObjectiveMarker
    {
        public string Id;
        public int Col;
        public int Row;
        public List<HexCoord> Hexes = new();
        public SeatId? Controller;
    }
}
