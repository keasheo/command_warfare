namespace CommandWarfare.Core.Types
{
    /// <summary>Ported from play/shared/types.ts</summary>
    public enum SeatId { N, W, S, E }

    public enum UnitKind { Commander, Officer, Unit }

    public enum Phase
    {
        Lobby,
        ArmyBuild,
        Commanders,
        Objectives,
        ForceSelect,
        Terrain,
        Deploy,
        Play,
        Ended,
    }
}
