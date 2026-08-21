using CommandWarfare.Core.Types;
using UnityEngine;

namespace CommandWarfare.Core.Util
{
    /// <summary>Seat + race tint helpers for token / HUD visuals.</summary>
    public static class RaceColors
    {
        public static Color ForRace(string race) => (race ?? "").Trim().ToLowerInvariant() switch
        {
            "human" => new Color(0.35f, 0.55f, 0.85f),
            "dwarf" => new Color(0.75f, 0.45f, 0.25f),
            "elf" => new Color(0.35f, 0.75f, 0.45f),
            "undead" => new Color(0.55f, 0.7f, 0.55f),
            "demon" => new Color(0.75f, 0.2f, 0.25f),
            "dragon" => new Color(0.85f, 0.35f, 0.15f),
            "beastfolk" => new Color(0.65f, 0.5f, 0.3f),
            "lizardmen" or "lizardman" => new Color(0.25f, 0.65f, 0.4f),
            "construct" => new Color(0.55f, 0.55f, 0.6f),
            _ => new Color(0.6f, 0.6f, 0.65f),
        };

        /// <summary>Blend seat identity with race tint for readable tokens.</summary>
        public static Color TokenColor(SeatId seatId, string race)
        {
            var seatCol = SeatColors.Fill(seatId);
            var raceCol = ForRace(race);
            return Color.Lerp(seatCol, raceCol, 0.55f);
        }
    }
}
