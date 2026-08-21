using UnityEngine;

namespace CommandWarfare.Board
{
    /// <summary>World-space damage/hit floater (procedural TextMesh until UI canvas added).</summary>
    public static class CombatFx
    {
        public static void SpawnFloatingText(Vector3 worldPos, string text, Color color)
        {
            var go = new GameObject("CombatFx");
            go.transform.position = worldPos + Vector3.up * 1.2f;
            var tm = go.AddComponent<TextMesh>();
            tm.text = text;
            tm.fontSize = 48;
            tm.characterSize = 0.04f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = color;
            go.AddComponent<FloatingTextLifetime>();
        }
    }

    class FloatingTextLifetime : MonoBehaviour
    {
        [SerializeField] float _duration = 1.4f;
        [SerializeField] float _riseSpeed = 0.8f;
        TextMesh _text;
        float _t;

        void Awake() => _text = GetComponent<TextMesh>();

        void Update()
        {
            _t += Time.deltaTime;
            transform.position += Vector3.up * (_riseSpeed * Time.deltaTime);
            if (_text != null)
            {
                var c = _text.color;
                c.a = 1f - (_t / _duration);
                _text.color = c;
            }
            if (_t >= _duration)
                Destroy(gameObject);
        }
    }
}
