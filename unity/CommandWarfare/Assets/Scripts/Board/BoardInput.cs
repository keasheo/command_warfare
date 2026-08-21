using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>Works with legacy Input Manager or the new Input System package.</summary>
    static class BoardInput
    {
        public static bool LeftMouseDown()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Mouse.current?.leftButton.wasPressedThisFrame ?? false;
#else
            return Input.GetMouseButtonDown(0);
#endif
        }

        public static bool RightMouseDown()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Mouse.current?.rightButton.wasPressedThisFrame ?? false;
#else
            return Input.GetMouseButtonDown(1);
#endif
        }

        public static bool EndTurnKeyDown()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Keyboard.current?.eKey.wasPressedThisFrame ?? false;
#else
            return Input.GetKeyDown(KeyCode.E);
#endif
        }

        public static bool KeyDown(KeyCode key)
        {
#if ENABLE_INPUT_SYSTEM
            var k = UnityEngine.InputSystem.Keyboard.current;
            if (k == null) return false;
            return key switch
            {
                KeyCode.H => k.hKey.wasPressedThisFrame,
                KeyCode.V => k.vKey.wasPressedThisFrame,
                KeyCode.R => k.rKey.wasPressedThisFrame,
                KeyCode.U => k.uKey.wasPressedThisFrame,
                KeyCode.Z => k.zKey.wasPressedThisFrame,
                KeyCode.E => k.eKey.wasPressedThisFrame,
                KeyCode.Escape => k.escapeKey.wasPressedThisFrame,
                KeyCode.LeftControl => k.leftCtrlKey.wasPressedThisFrame,
                KeyCode.RightControl => k.rightCtrlKey.wasPressedThisFrame,
                _ => false,
            };
#else
            return Input.GetKeyDown(key);
#endif
        }

        public static bool KeyHeld(KeyCode key)
        {
#if ENABLE_INPUT_SYSTEM
            var k = UnityEngine.InputSystem.Keyboard.current;
            if (k == null) return false;
            return key switch
            {
                KeyCode.LeftControl => k.leftCtrlKey.isPressed,
                KeyCode.RightControl => k.rightCtrlKey.isPressed,
                KeyCode.LeftShift => k.leftShiftKey.isPressed,
                KeyCode.RightShift => k.rightShiftKey.isPressed,
                _ => false,
            };
#else
            return Input.GetKey(key);
#endif
        }

        public static bool CtrlHeld() =>
            KeyHeld(KeyCode.LeftControl) || KeyHeld(KeyCode.RightControl);

        public static bool UndoHotkeyDown() =>
            KeyDown(KeyCode.U) || (KeyDown(KeyCode.Z) && CtrlHeld());

        public static bool RightMouseHeld()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Mouse.current?.rightButton.isPressed ?? false;
#else
            return Input.GetMouseButton(1);
#endif
        }

        public static bool MiddleMouseHeld()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Mouse.current?.middleButton.isPressed ?? false;
#else
            return Input.GetMouseButton(2);
#endif
        }

        public static bool ShiftHeld() =>
            KeyHeld(KeyCode.LeftShift) || KeyHeld(KeyCode.RightShift);

        /// <summary>WASD / arrows as XZ pan vector (x = strafe, y = forward).</summary>
        public static Vector2 KeyboardPan()
        {
#if ENABLE_INPUT_SYSTEM
            var k = UnityEngine.InputSystem.Keyboard.current;
            if (k == null) return Vector2.zero;
            var x = 0f;
            var y = 0f;
            if (k.aKey.isPressed || k.leftArrowKey.isPressed) x -= 1f;
            if (k.dKey.isPressed || k.rightArrowKey.isPressed) x += 1f;
            if (k.sKey.isPressed || k.downArrowKey.isPressed) y -= 1f;
            if (k.wKey.isPressed || k.upArrowKey.isPressed) y += 1f;
            return new Vector2(x, y);
#else
            var x = 0f;
            var y = 0f;
            if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) x -= 1f;
            if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) x += 1f;
            if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) y -= 1f;
            if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) y += 1f;
            return new Vector2(x, y);
#endif
        }

        public static Vector2 MouseDelta()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Mouse.current?.delta.ReadValue() ?? Vector2.zero;
#else
            return new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y"));
#endif
        }

        public static float ScrollY()
        {
#if ENABLE_INPUT_SYSTEM
            return UnityEngine.InputSystem.Mouse.current?.scroll.ReadValue().y ?? 0f;
#else
            return Input.mouseScrollDelta.y;
#endif
        }

        public static Vector3 MousePosition()
        {
#if ENABLE_INPUT_SYSTEM
            var p = UnityEngine.InputSystem.Mouse.current?.position.ReadValue() ?? Vector2.zero;
            return new Vector3(p.x, p.y, 0f);
#else
            return Input.mousePosition;
#endif
        }
    }
}
