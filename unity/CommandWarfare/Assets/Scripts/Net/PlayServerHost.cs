using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading.Tasks;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace CommandWarfare.Net
{
    /// <summary>
    /// Client-host pattern: when the player hosts, ensure a local authoritative play
    /// server is running, then the Unity client connects as the room host.
    /// Same shape as games that launch a companion dedicated process on "Host"
    /// (authority stays on the play server; Unity is never a silent bat-file step).
    /// </summary>
    public static class PlayServerHost
    {
        public const int DefaultPort = 8788;
        public const string DefaultPath = "/ws";

        static Process _owned;
        static string _repoRoot;
        static string _lastError;

        public static bool OwnsProcess => _owned != null && !_owned.HasExited;
        public static string LastError => _lastError;
        public static string RepoRoot => _repoRoot;

        /// <summary>True if something already accepts TCP on the play port.</summary>
        public static bool IsServerReachable(string host = "127.0.0.1", int port = DefaultPort)
        {
            try
            {
                using var client = new TcpClient();
                var ar = client.BeginConnect(host, port, null, null);
                var ok = ar.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(200));
                if (!ok) return false;
                client.EndConnect(ar);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static async Task<bool> EnsureRunningAsync(
            Action<string> status = null,
            int port = DefaultPort,
            int timeoutMs = 20000)
        {
            _lastError = null;
            if (IsServerReachable("127.0.0.1", port))
            {
                status?.Invoke("Play server already running.");
                return true;
            }

            if (!TryStartProcess(port, out var err))
            {
                _lastError = err;
                status?.Invoke(err);
                return false;
            }

            status?.Invoke("Starting local play server…");
            var deadline = TimeSpan.FromMilliseconds(timeoutMs);
            var start = DateTime.UtcNow;
            while (DateTime.UtcNow - start < deadline)
            {
                if (IsServerReachable("127.0.0.1", port))
                {
                    status?.Invoke("Local play server ready.");
                    return true;
                }
                if (_owned != null && _owned.HasExited)
                {
                    _lastError = "Play server process exited early. Is Node.js installed?";
                    status?.Invoke(_lastError);
                    return false;
                }
                await Task.Delay(250);
            }

            _lastError = $"Timed out waiting for play server on port {port}.";
            status?.Invoke(_lastError);
            return false;
        }

        public static void StopOwned()
        {
            if (_owned == null) return;
            try
            {
                if (!_owned.HasExited)
                {
                    _owned.Kill();
                    _owned.WaitForExit(3000);
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("[PlayServerHost] Stop: " + e.Message);
            }
            finally
            {
                _owned.Dispose();
                _owned = null;
            }
        }

        public static string GetPreferredLanIPv4()
        {
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback
                        or NetworkInterfaceType.Tunnel)
                        continue;
                    var props = ni.GetIPProperties();
                    foreach (var addr in props.UnicastAddresses)
                    {
                        if (addr.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        var ip = addr.Address.ToString();
                        if (ip.StartsWith("127.")) continue;
                        if (ip.StartsWith("169.254.")) continue;
                        return ip;
                    }
                }
            }
            catch { /* ignore */ }
            return "127.0.0.1";
        }

        static bool TryStartProcess(int port, out string error)
        {
            error = null;
            if (_owned != null && !_owned.HasExited) return true;

            if (!TryResolveRepoRoot(out _repoRoot, out error))
                return false;

            var entry = Path.Combine(_repoRoot, "play", "server", "index.ts");
            if (!File.Exists(entry))
            {
                error = $"Missing play server at {entry}";
                return false;
            }

            var npx = FindOnPath(Application.platform == RuntimePlatform.WindowsPlayer
                || Application.platform == RuntimePlatform.WindowsEditor
                ? "npx.cmd" : "npx");
            if (string.IsNullOrEmpty(npx))
            {
                error = "Node.js / npx not found on PATH. Install Node 20+ to host locally.";
                return false;
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = npx,
                    Arguments = $"--yes tsx \"{entry}\"",
                    WorkingDirectory = _repoRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.EnvironmentVariables["PLAY_WS_PORT"] = port.ToString();

                _owned = new Process { StartInfo = psi, EnableRaisingEvents = true };
                _owned.OutputDataReceived += (_, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                        Debug.Log("[PlayServer] " + e.Data);
                };
                _owned.ErrorDataReceived += (_, e) =>
                {
                    if (!string.IsNullOrEmpty(e.Data))
                        Debug.LogWarning("[PlayServer] " + e.Data);
                };
                if (!_owned.Start())
                {
                    error = "Failed to start play server process.";
                    _owned = null;
                    return false;
                }
                _owned.BeginOutputReadLine();
                _owned.BeginErrorReadLine();
                Debug.Log($"[PlayServerHost] Started pid={_owned.Id} root={_repoRoot}");
                return true;
            }
            catch (Exception e)
            {
                error = "Could not start play server: " + e.Message;
                _owned = null;
                return false;
            }
        }

        static bool TryResolveRepoRoot(out string root, out string error)
        {
            root = null;
            error = null;

            var env = Environment.GetEnvironmentVariable("CW_REPO_ROOT");
            if (!string.IsNullOrWhiteSpace(env) && HasPlayServer(env))
            {
                root = Path.GetFullPath(env);
                return true;
            }

            // Walk up from Assets / project for play/server/index.ts
            var dir = new DirectoryInfo(Application.dataPath);
            for (var i = 0; i < 8 && dir != null; i++)
            {
                if (HasPlayServer(dir.FullName))
                {
                    root = dir.FullName;
                    return true;
                }
                dir = dir.Parent;
            }

            // Dev fallback: known checkout next to a standalone Unity clone.
            var fallback = @"C:\Users\keash\Projects\CommandWarfare";
            if (HasPlayServer(fallback))
            {
                root = fallback;
                return true;
            }

            error =
                "Could not find CommandWarfare repo (play/server/index.ts). " +
                "Set env CW_REPO_ROOT to the repo root, or open the Unity project under the git tree.";
            return false;
        }

        static bool HasPlayServer(string root) =>
            File.Exists(Path.Combine(root, "play", "server", "index.ts"));

        static string FindOnPath(string fileName)
        {
            try
            {
                var path = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (var part in path.Split(Path.PathSeparator))
                {
                    if (string.IsNullOrWhiteSpace(part)) continue;
                    var full = Path.Combine(part.Trim(), fileName);
                    if (File.Exists(full)) return full;
                }
            }
            catch { /* ignore */ }
            return null;
        }
    }
}
