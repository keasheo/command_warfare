using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Orbit + pan camera for the hex board (RMB orbit, MMB/Shift+RMB pan, scroll zoom, WASD pan).</summary>
    public class BoardCameraController : MonoBehaviour
    {
        [SerializeField] Transform _target;
        [SerializeField] float _distance = 48f;
        [SerializeField] float _minDistance = 18f;
        [SerializeField] float _maxDistance = 90f;
        [SerializeField] float _orbitSpeed = 4f;
        [SerializeField] float _panSpeed = 0.08f;
        [SerializeField] float _keyPanSpeed = 18f;
        [SerializeField] float _zoomSpeed = 6f;
        [SerializeField] float _pitch = 52f;
        [SerializeField] float _yaw = 35f;

        Vector3 _focus;
        bool _hasFocus;

        void LateUpdate()
        {
            // Never move the board/target — only the camera. Moving HexBoard with pan
            // cancelled all translation (camera + board slid together).
            if (!_hasFocus && _target != null)
            {
                _focus = _target.position;
                _hasFocus = true;
            }
            if (!_hasFocus) return;

            var focus = _focus;

            // Orbit — right mouse (without shift)
            var orbit = BoardInput.RightMouseHeld() && !BoardInput.ShiftHeld();
            if (orbit)
            {
                _yaw += BoardInput.MouseDelta().x * _orbitSpeed;
                _pitch -= BoardInput.MouseDelta().y * _orbitSpeed;
                _pitch = Mathf.Clamp(_pitch, 18f, 78f);
            }

            // Pan — middle mouse, or Shift+RMB, or WASD
            var panMouse = BoardInput.MiddleMouseHeld() ||
                           (BoardInput.RightMouseHeld() && BoardInput.ShiftHeld());
            if (panMouse)
            {
                var delta = BoardInput.MouseDelta();
                var right = transform.right;
                right.y = 0f;
                right.Normalize();
                var forward = transform.forward;
                forward.y = 0f;
                forward.Normalize();
                var scale = _panSpeed * (_distance / 40f);
                focus -= (right * delta.x + forward * delta.y) * scale;
            }

            var key = BoardInput.KeyboardPan();
            if (key.sqrMagnitude > 0.01f)
            {
                var right = transform.right;
                right.y = 0f;
                right.Normalize();
                var forward = transform.forward;
                forward.y = 0f;
                forward.Normalize();
                focus += (right * key.x + forward * key.y) * (_keyPanSpeed * Time.unscaledDeltaTime * (_distance / 40f));
            }

            _distance -= BoardInput.ScrollY() * 0.01f * _zoomSpeed;
            _distance = Mathf.Clamp(_distance, _minDistance, _maxDistance);

            _focus = focus;

            var rot = Quaternion.Euler(_pitch, _yaw, 0f);
            var offset = rot * new Vector3(0f, 0f, -_distance);
            transform.position = _focus + offset;
            transform.rotation = rot;
        }

        public void SetTarget(Transform target)
        {
            _target = target;
            if (target != null)
            {
                _focus = target.position;
                _hasFocus = true;
            }
        }

        public void FocusWorld(Vector3 world)
        {
            _focus = world;
            _hasFocus = true;
        }

        /// <summary>After CenterBoard, map center is at world origin.</summary>
        public void FocusBoardCenter() => FocusWorld(Vector3.zero);
    }
}
