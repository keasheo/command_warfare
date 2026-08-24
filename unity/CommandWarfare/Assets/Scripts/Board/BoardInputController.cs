using CommandWarfare.Units;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Raycast hex / unit selection — replaces SVG click handling from HexBoard.tsx.</summary>
    [RequireComponent(typeof(HexBoardBuilder))]
    public class BoardInputController : MonoBehaviour
    {
        HexBoardBuilder _board;
        Camera _camera;

        /// <summary>Unit under the cursor this frame (null if none).</summary>
        public string HoveredUnitId { get; private set; }

        /// <summary>When true, left-clicks are claimed by the HUD and must not hit the board.</summary>
        public static bool HudBlocksBoardClicks { get; set; }

        void Awake()
        {
            _board = GetComponent<HexBoardBuilder>();
            _camera = Camera.main;
        }

        void Update()
        {
            if (_camera == null) _camera = Camera.main;
            if (_camera == null)
            {
                HoveredUnitId = null;
                return;
            }

            UpdateHover();

            if (!BoardInput.LeftMouseDown()) return;
            // Prefer live HUD strip check — LateUpdate flag can lag one frame behind the cursor.
            if (HudBlocksBoardClicks || MouseOverPlayHudStrip()) return;

            var tile = RaycastBoardTile();
            if (tile != null)
                _board.NotifyTileClicked(tile);
        }

        static bool MouseOverPlayHudStrip()
        {
            var right = SkirmishHud.BoardClickBlockRightX;
            if (right <= 1f) return false;
            return BoardInput.MousePosition().x <= right;
        }

        void UpdateHover()
        {
            HoveredUnitId = null;
            // Always track hover for Shift+inspect — only clicks are HUD-blocked.
            var hits = RaycastHits();
            if (hits == null) return;

            foreach (var hit in hits)
            {
                if (hit.collider == null) continue;
                var token = hit.collider.GetComponentInParent<UnitTokenView>();
                if (token != null && !string.IsNullOrEmpty(token.UnitId))
                {
                    HoveredUnitId = token.UnitId;
                    return;
                }
            }
        }

        HexTile RaycastBoardTile()
        {
            var hits = RaycastHits();
            if (hits == null) return null;

            foreach (var hit in hits)
            {
                if (hit.collider == null) continue;

                var token = hit.collider.GetComponentInParent<UnitTokenView>();
                if (token != null)
                {
                    var tokenTile = _board.FindTile(token.Col, token.Row);
                    if (tokenTile != null) return tokenTile;
                }

                var tile = hit.collider.GetComponentInParent<HexTile>();
                if (tile != null) return tile;
            }

            return null;
        }

        RaycastHit[] RaycastHits()
        {
            var ray = _camera.ScreenPointToRay(BoardInput.MousePosition());
            var hits = Physics.RaycastAll(ray, 500f);
            if (hits == null || hits.Length == 0) return null;
            System.Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));
            return hits;
        }
    }
}
