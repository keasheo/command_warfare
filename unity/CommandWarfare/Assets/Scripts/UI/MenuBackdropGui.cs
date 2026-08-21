using System.IO;
using UnityEngine;

namespace CommandWarfare.UI
{
    /// <summary>
    /// Full-screen menu backdrop from StreamingAssets (MTG-style war-torn plate).
    /// Drawn in OnGUI so it always sits behind IMGUI panels.
    /// </summary>
    public static class MenuBackdropGui
    {
        const string FileName = "war-torn-battlescape-mtg.png";

        static Texture2D _tex;
        static Texture2D _dim;
        static bool _tried;
        static string _fail;

        public static void Draw()
        {
            Ensure();
            var screen = new Rect(0, 0, Screen.width, Screen.height);
            if (_tex != null)
            {
                GUI.DrawTexture(screen, _tex, ScaleMode.ScaleAndCrop);
            }
            else
            {
                // Fallback wash so menus never sit on empty clear color.
                var prev = GUI.color;
                GUI.color = new Color(0.08f, 0.07f, 0.06f, 1f);
                GUI.DrawTexture(screen, Texture2D.whiteTexture);
                GUI.color = prev;
            }

            if (_dim == null)
            {
                _dim = new Texture2D(1, 1, TextureFormat.RGBA32, false);
                _dim.SetPixel(0, 0, Color.white);
                _dim.Apply();
                _dim.hideFlags = HideFlags.HideAndDontSave;
            }
            var p = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, 0.42f);
            GUI.DrawTexture(screen, _dim);
            GUI.color = p;
        }

        static void Ensure()
        {
            if (_tex != null || _tried) return;
            _tried = true;
            var candidates = new[]
            {
                Path.Combine(Application.streamingAssetsPath, FileName),
                Path.Combine(Application.dataPath, "StreamingAssets", FileName),
                Path.Combine(Application.dataPath, "Art", FileName),
            };
            foreach (var path in candidates)
            {
                if (!File.Exists(path)) continue;
                try
                {
                    var bytes = File.ReadAllBytes(path);
                    var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                    if (!tex.LoadImage(bytes))
                    {
                        UnityEngine.Object.Destroy(tex);
                        continue;
                    }
                    tex.wrapMode = TextureWrapMode.Clamp;
                    tex.filterMode = FilterMode.Bilinear;
                    tex.hideFlags = HideFlags.HideAndDontSave;
                    _tex = tex;
                    return;
                }
                catch (System.Exception e)
                {
                    _fail = e.Message;
                }
            }
            _fail ??= FileName + " not found in StreamingAssets/Art";
            Debug.LogWarning("[MenuBackdrop] " + _fail);
        }
    }
}
