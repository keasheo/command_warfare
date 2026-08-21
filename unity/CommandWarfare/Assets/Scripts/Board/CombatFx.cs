using System.Text.RegularExpressions;
using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>World-space combat floaters + screen drama hooks.</summary>
    public static class CombatFx
    {
        static readonly Regex DamageRe = new(@"(\d+)\s*(dmg|damage)", RegexOptions.IgnoreCase);
        static readonly Regex DiceRe = new(@"(\d+)\s*[dD](\d+)", RegexOptions.IgnoreCase);

        public static void SpawnFloatingText(Vector3 worldPos, string text, Color color)
        {
            var go = new GameObject("CombatFx");
            go.transform.position = worldPos + Vector3.up * 1.2f;
            var tm = go.AddComponent<TextMesh>();
            tm.text = text;
            tm.fontSize = 48;
            tm.characterSize = 0.045f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = color;
            go.AddComponent<FloatingTextLifetime>();
        }

        public static void SpawnFromCombatLog(Vector3 worldPos, string log)
        {
            if (string.IsNullOrEmpty(log))
            {
                SpawnFloatingText(worldPos, "?", Color.gray);
                return;
            }

            var lower = log.ToLowerInvariant();
            var hit = lower.Contains("hit") || lower.Contains("dealt") || lower.Contains("damage");
            var miss = lower.Contains("miss");

            string primary;
            Color color;
            if (miss && !hit)
            {
                primary = "Miss";
                color = new Color(0.75f, 0.75f, 0.8f);
            }
            else
            {
                var dm = DamageRe.Match(log);
                if (dm.Success)
                {
                    primary = $"-{dm.Groups[1].Value}";
                    color = new Color(1f, 0.35f, 0.28f);
                }
                else if (log.Contains(" for "))
                {
                    var part = log.Split(new[] { " for " }, System.StringSplitOptions.None);
                    primary = part.Length > 1 ? part[1].Split(' ')[0] : "Hit";
                    color = new Color(1f, 0.4f, 0.3f);
                }
                else
                {
                    primary = hit ? "Hit" : "…";
                    color = new Color(1f, 0.55f, 0.35f);
                }
            }

            SpawnFloatingText(worldPos, primary, color);

            var dice = DiceRe.Match(log);
            if (dice.Success)
            {
                SpawnFloatingText(
                    worldPos + Vector3.right * 0.35f + Vector3.up * 0.25f,
                    $"{dice.Groups[1].Value}d{dice.Groups[2].Value}",
                    new Color(1f, 0.92f, 0.45f));
            }
            else
            {
                // "2d6 [3+4]=7 need 6+" style from combat log
                var bracket = System.Text.RegularExpressions.Regex.Match(
                    log, @"2d6\s*\[(\d+)\+(\d+)\]=(\d+)");
                if (bracket.Success)
                {
                    SpawnFloatingText(
                        worldPos + Vector3.right * 0.4f + Vector3.up * 0.3f,
                        $"{bracket.Groups[1].Value}+{bracket.Groups[2].Value}={bracket.Groups[3].Value}",
                        new Color(1f, 0.92f, 0.45f));
                }
            }

            BoardDrama.Punch(hit && !miss ? 0.22f : 0.08f);
        }
    }

    class FloatingTextLifetime : MonoBehaviour
    {
        [SerializeField] float _duration = 1.5f;
        [SerializeField] float _riseSpeed = 0.95f;
        TextMesh _text;
        float _t;
        Vector3 _startScale;

        void Awake()
        {
            _text = GetComponent<TextMesh>();
            _startScale = transform.localScale;
            transform.localScale = _startScale * 0.4f;
        }

        void Update()
        {
            _t += Time.deltaTime;
            var u = Mathf.Clamp01(_t / _duration);
            transform.position += Vector3.up * (_riseSpeed * Time.deltaTime);
            var pop = u < 0.15f ? Mathf.Lerp(0.4f, 1.15f, u / 0.15f) : Mathf.Lerp(1.15f, 1f, (u - 0.15f) / 0.85f);
            transform.localScale = _startScale * pop;
            if (_text != null)
            {
                var c = _text.color;
                c.a = 1f - u;
                _text.color = c;
            }
            // Face camera
            var cam = Camera.main;
            if (cam != null)
                transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);

            if (_t >= _duration)
                Destroy(gameObject);
        }
    }

    /// <summary>Brief camera punch / vignette-style shake for hits.</summary>
    public static class BoardDrama
    {
        static float _shakeUntil;
        static float _shakeAmp;
        static Vector3 _shakeOffset;

        public static void Punch(float amplitude = 0.2f)
        {
            _shakeAmp = Mathf.Max(_shakeAmp, amplitude);
            _shakeUntil = Time.unscaledTime + 0.18f;
        }

        public static Vector3 CurrentOffset()
        {
            if (Time.unscaledTime > _shakeUntil)
            {
                _shakeAmp = 0f;
                _shakeOffset = Vector3.zero;
                return Vector3.zero;
            }
            var t = (_shakeUntil - Time.unscaledTime) / 0.18f;
            var amp = _shakeAmp * t;
            _shakeOffset = new Vector3(
                (Mathf.PerlinNoise(Time.unscaledTime * 40f, 0.1f) * 2f - 1f) * amp,
                (Mathf.PerlinNoise(0.2f, Time.unscaledTime * 40f) * 2f - 1f) * amp * 0.6f,
                0f);
            return _shakeOffset;
        }
    }
}
