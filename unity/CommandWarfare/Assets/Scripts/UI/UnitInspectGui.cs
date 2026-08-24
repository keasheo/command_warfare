using System.Collections.Generic;
using CommandWarfare.Core;
using CommandWarfare.Core.Deploy;
using CommandWarfare.Core.Hex;
using CommandWarfare.Core.State;
using CommandWarfare.Core.Types;
using CommandWarfare.Data;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>Unit inspect: compact stats + full card face on the battlefield HUD.</summary>
    public static class UnitInspectGui
    {
        public static void Draw(GameState state, UnitToken unit, CardDatabase cards = null, AbilityDatabase abilities = null)
        {
            if (state == null || unit == null) return;
            MenuStyle.Ensure();

            var card = cards != null
                ? cards.FindByIdOrName(unit.CardId, unit.CardName)
                : null;
            var activation = UnitBattleAvailability.Describe(state, unit, abilities);

            var cardW = Mathf.Clamp(Screen.width * 0.26f, 200f, 300f);
            var cardH = cardW * (CardFaceGui.RefH / CardFaceGui.RefW);
            var statsH = 150f;
            var gap = 8f;
            var totalH = statsH + gap + cardH;
            if (totalH > Screen.height - 24f)
            {
                var scale = (Screen.height - 24f - statsH - gap) / cardH;
                cardW *= Mathf.Max(0.45f, scale);
                cardH = cardW * (CardFaceGui.RefH / CardFaceGui.RefW);
            }

            var x = Screen.width - cardW - 12f;
            var y = 12f;

            var role = unit.Kind switch
            {
                UnitKind.Commander => unit.Promoted || HasPromotedKeyword(unit) ? "PC · Commander" : "C · Commander",
                UnitKind.Officer => unit.Promoted || HasPromotedKeyword(unit) ? "PO · Officer" : "O · Officer",
                _ => "U · Unit",
            };
            var statsRect = new Rect(x, y, cardW, statsH);
            MenuStyle.DrawPanel(statsRect, role);

            var sx = statsRect.x + 12f;
            var sy = statsRect.y + 36f;
            var iw = statsRect.width - 24f;

            GUI.Label(new Rect(sx, sy, iw, 18), $"{unit.CardName}", MenuStyle.Body);
            sy += 18f;
            GUI.Label(new Rect(sx, sy, iw, 16), $"{unit.Race} · {unit.Seat}", MenuStyle.MutedLabel);
            sy += 16f;

            var hp = unit.ToughnessCurrent ?? unit.Toughness;
            var hpMax = unit.Toughness;
            GUI.Label(new Rect(sx, sy, iw, 16),
                hpMax.HasValue ? $"HP {hp ?? 0}/{hpMax.Value} · Mv {unit.MoveRemaining}/{unit.Move}" : $"Mv {unit.MoveRemaining}/{unit.Move}",
                MenuStyle.Body);
            sy += 16f;
            GUI.Label(new Rect(sx, sy, iw, 16),
                $"Dmg {unit.Damage?.ToString() ?? "—"} · Rng {unit.Range?.ToString() ?? "—"}",
                MenuStyle.Body);
            sy += 16f;

            GUI.color = ActivationColor(activation.Tone);
            GUI.Label(new Rect(sx, sy, iw, 16), activation.StatusLabel, MenuStyle.Body);
            GUI.color = Color.white;
            sy += 16f;

            var statuses = StatusLine(unit);
            if (!string.IsNullOrEmpty(statuses))
                GUI.Label(new Rect(sx, sy, iw, 16), statuses, MenuStyle.MutedLabel);

            var cardRect = new Rect(x, statsRect.yMax + gap, cardW, cardH);
            CardFaceGui.Draw(cardRect, card, abilities);
        }

        static Color ActivationColor(UnitBattleAvailability.Tone tone) => tone switch
        {
            UnitBattleAvailability.Tone.Ready => new Color(0.55f, 0.9f, 0.55f),
            UnitBattleAvailability.Tone.Active => new Color(0.95f, 0.85f, 0.4f),
            UnitBattleAvailability.Tone.Done => new Color(0.7f, 0.65f, 0.6f),
            _ => new Color(0.75f, 0.75f, 0.75f),
        };

        static bool HasPromotedKeyword(UnitToken unit)
        {
            if (unit?.Keywords == null) return false;
            foreach (var k in unit.Keywords)
            {
                if (!string.IsNullOrEmpty(k) &&
                    k.Equals("Promoted", System.StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        static string StatusLine(UnitToken unit)
        {
            var parts = new List<string>();
            if (unit.Rooted) parts.Add("Rooted");
            if (unit.Fear) parts.Add("Fear");
            if (unit.TerrorFear) parts.Add("Terror");
            if (unit.Slow) parts.Add("Slow");
            if (unit.EvadeActive) parts.Add("Evade");
            if (unit.BonePrisoned) parts.Add("Bone Prison");
            if (unit.AttackedThisTurn) parts.Add("Attacked");
            if (unit.Harden > 0) parts.Add($"Harden {unit.Harden}");
            if (unit.PoisonTokens > 0) parts.Add($"Poison {unit.PoisonTokens}");
            if (parts.Count == 0) return null;
            return string.Join(" · ", parts);
        }
    }
}
