using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Raycast hex selection — replaces SVG click handling from HexBoard.tsx.</summary>
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
            if (!Physics.Raycast(ray, out var hit, 500f)) return;

            var tile = hit.collider.GetComponentInParent<HexTile>();
            if (tile != null)
                _board.NotifyTileClicked(tile);
        }
    }
}
