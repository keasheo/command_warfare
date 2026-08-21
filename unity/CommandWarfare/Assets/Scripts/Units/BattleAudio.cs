using UnityEngine;

namespace CommandWarfare.Units
{
    /// <summary>Lightweight SFX bus for battle presentation (procedural clips until art pack lands).</summary>
    public static class BattleAudio
    {
        static AudioSource _oneShot;
        static AudioSource _walkLoop;
        static float _walkUntil;
        static bool _muted;
        static float _volume = 0.55f;

        public static bool Muted
        {
            get => _muted;
            set => _muted = value;
        }

        public static float Volume
        {
            get => _volume;
            set => _volume = Mathf.Clamp01(value);
        }

        static void Ensure()
        {
            if (_oneShot != null) return;
            var go = new GameObject("BattleAudio");
            Object.DontDestroyOnLoad(go);
            _oneShot = go.AddComponent<AudioSource>();
            _oneShot.playOnAwake = false;
            _oneShot.spatialBlend = 0f;
            _walkLoop = go.AddComponent<AudioSource>();
            _walkLoop.playOnAwake = false;
            _walkLoop.loop = true;
            _walkLoop.spatialBlend = 0f;
        }

        public static void PlayWalk()
        {
            if (_muted) return;
            Ensure();
            _walkUntil = Time.unscaledTime + 0.35f;
            if (!_walkLoop.isPlaying)
            {
                _walkLoop.clip = MakeNoiseClip(0.12f, 180f, 0.15f);
                _walkLoop.volume = _volume * 0.25f;
                _walkLoop.Play();
            }
        }

        public static void Tick()
        {
            if (_walkLoop == null) return;
            if (Time.unscaledTime > _walkUntil && _walkLoop.isPlaying)
                _walkLoop.Stop();
        }

        public static void PlayAttack()
        {
            PlayOneShot(MakeNoiseClip(0.08f, 90f, 0.45f), 0.7f);
        }

        public static void PlayHit()
        {
            PlayOneShot(MakeNoiseClip(0.1f, 140f, 0.55f), 0.75f);
        }

        public static void PlayMiss()
        {
            PlayOneShot(MakeNoiseClip(0.06f, 320f, 0.2f), 0.4f);
        }

        public static void PlayAbility()
        {
            PlayOneShot(MakeNoiseClip(0.14f, 220f, 0.35f), 0.6f);
        }

        static void PlayOneShot(AudioClip clip, float gain)
        {
            if (_muted || clip == null) return;
            Ensure();
            _oneShot.PlayOneShot(clip, _volume * gain);
        }

        /// <summary>Tiny procedural beep — replace with real AudioClips later.</summary>
        static AudioClip MakeNoiseClip(float seconds, float freq, float amp)
        {
            var sampleRate = 22050;
            var samples = Mathf.CeilToInt(seconds * sampleRate);
            var data = new float[samples];
            for (var i = 0; i < samples; i++)
            {
                var t = i / (float)sampleRate;
                var env = 1f - t / seconds;
                var wave = Mathf.Sin(2f * Mathf.PI * freq * t);
                // Soft noise mix so attacks don't sound like pure tones.
                var noise = (Random.value * 2f - 1f) * 0.35f;
                data[i] = (wave * 0.65f + noise) * amp * env * env;
            }
            var clip = AudioClip.Create($"sfx_{freq}", samples, 1, sampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
