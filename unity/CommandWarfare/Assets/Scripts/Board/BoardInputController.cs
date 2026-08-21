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

        void Awake()
        {
            _board = GetComponent<HexBoardBuilder>();
            _camera = Camera.main;
        }

        void Update()
        {
            if (_camera == null) _camera = Camera.main;
            if (_camera == null || !BoardInput.LeftMouseDown()) return;

            var ray = _camera.ScreenPointToRay(BoardInput.MousePosition());
            // Prefer the closest hit so standing on a hex still selects the unit mesh.
            var hits = Physics.RaycastAll(ray, 500f);
            if (hits == null || hits.Length == 0) return;
            System.Array.Sort(hits, (a, b) => a.distance.CompareTo(b.distance));

            foreach (var hit in hits)
            {
                if (hit.collider == null) continue;

                var token = hit.collider.GetComponentInParent<UnitTokenView>();
                if (token != null)
                {
                    var tokenTile = _board.FindTile(token.Col, token.Row);
                    if (tokenTile != null)
                    {
                        _board.NotifyTileClicked(tokenTile);
                        return;
                    }
                }

                var tile = hit.collider.GetComponentInParent<HexTile>();
                if (tile != null)
                {
                    _board.NotifyTileClicked(tile);
                    return;
                }
            }
        }
    }
}
