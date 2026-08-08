# Command Warfare — Play prototype

WebSocket multiplayer hex prototype (2P now, 4P-ready). Not Unreal/Unity/Godot — browser + Node.

Players **build an army** from the card roster (≤250 UV list cap: 155 deploy + 45 reserve + 50 flex swap room, officer company capacity). Hosts can require mono-race lists (officers & units match commander) or allow mixed-race armies at room creation.

## Run locally

From the CommandWarfare repo root:

```bash
npm run dev:play
```

That starts **both** listeners (same play WebSocket / rooms):

| Who | URL | Notes |
|-----|-----|--------|
| **Guests** (phone / other PCs) | **http://LAN_IP:5175** | Plain HTTP — **no cert warning** |
| **You** (this PC) | **https://localhost:5174** | Optional HTTPS after `npm run cert:dev` |
| HTTP-only fallback on this PC | **http://127.0.0.1:5175** | Always available |

- Play WebSocket: `ws://127.0.0.1:8788/ws` (shared by HTTP and HTTPS clients — same rooms)
- Card API: http://127.0.0.1:8787 (`/api` proxied from either Vite)

HTTP-only (no HTTPS process): `npm run dev:play:http`

Open **two browser tabs** (or two machines on the same network).

1. Tab A: enter a name → **Create room** (2P = North vs South)  
2. Copy the room code  
3. Tab B: enter a name → paste code → **Join room**  
4. Each player **builds and locks an army** (commander + officer companies with units) — click a slot, browse card thumbnails, preview the full card face  
5. When both armies are locked → both **Confirm commander**  
6. Objectives are drawn automatically; players place rotatable terrain pieces, then deploy  

7. Each deploys **every officer/unit from their locked list** — officers in their Command Radius, units in that officer’s Command Radius (≥5 hexes from objectives) → **Confirm deploy**  
8. On your turn: select O/U, click a hex within that unit’s Move; end adjacent to ★ to claim  

First to claim a **majority** of objectives wins (1 of 1, 2 of 2–3, etc.).

## Play with someone on the same Wi‑Fi (recommended)

**Guests use HTTP on port 5175** — zero setup, no cert warnings. You can stay on HTTPS locally; both hit the **same** play server and can join the **same room**.

1. On **your PC**, run `npm run dev:play` (or `play.bat`).
2. In the terminal, find the HTTP **Network** line, e.g. `http://192.168.1.42:5175`.
3. Share that **http://…:5175** URL with friends on the same Wi‑Fi — no install, no “proceed anyway”.
4. You open `https://localhost:5174` (or `http://127.0.0.1:5175`), create a room, send the **room code**; they join.

**How WebSockets work:** LAN/phone HTTP clients load Vite `:5175` but connect WebSocket to `ws://YOUR_LAN_IP:8788/ws`. HTTPS localhost uses the Vite `/ws` proxy. Same rooms either way.

**Firewall:** allow inbound TCP **5175**, **5174** (if you use HTTPS), and **8788** on the host PC.

Windows quick check for your LAN IP:

```powershell
ipconfig | findstr IPv4
```

Then share **`http://YOUR_LAN_IP:5175`** (note **http** and **5175**).

## HTTPS (optional — host PC only)

Self-signed and mkcert certs **cannot** remove warnings on other people’s phones without each guest installing a root CA. Guests should always use **HTTP :5175**.

| Goal | What to use |
|------|-------------|
| LAN play, no guest friction | **`npm run dev:play`** + share **`http://LAN_IP:5175`** |
| HTTPS on your own PC (alongside HTTP) | `npm run cert:dev` once, then **`npm run dev:play`** — open `https://localhost:5174` |
| HTTP only | **`npm run dev:play:http`** |
| HTTPS for WAN guests with no warnings | Public hostname + **Let’s Encrypt** / tunnel — not built into this repo |

```powershell
winget install FiloSottile.mkcert   # optional, host-only HTTPS
npm run cert:dev
npm run dev:play                    # HTTP :5175 + HTTPS :5174 together
```

If certs are missing, the HTTPS Vite process still starts but without TLS (or skip `cert:dev` and use HTTP on both machines via `:5175`).

### Player IP logging (phone / LAN / port-forward)

**Where to look:** the terminal running `npm run dev:play` (play server output). Each join / rejoin / leave / disconnect line includes `ip=…` for **that** client. Browser DevTools only shows **your own** connection IP in the welcome log — not peers.

- **Port-forward does not hide the phone IP.** The router forwards packets; your PC sees the remote peer.
- **What was hiding it:** Vite proxies `/ws` → `ws://127.0.0.1:8788`, so the play server used to see every client as `127.0.0.1`. The proxy now forwards `X-Forwarded-For`; `play/server/log.ts` reads that header.
- **HTTPS (host-only mode):** page loads from Vite; WebSocket uses `wss://HOST:5174/ws` through the proxy with forwarded IP.
- **HTTP LAN (guest path):** remote clients connect directly to `ws://HOST:8788/ws` (no proxy hop) — real client IP on the play server.
- **Same PC, two tabs:** both show `127.0.0.1` — expected.
- **Host UI:** open **Room** popout → **Connected players** shows seat, name, and IP (host only; not in public game log).

## Army save / import

Army files store **card names only** (not IDs or stats). On import, the builder looks up each name in the live roster and **rejects illegal lists** (missing cards, wrong race, company capacity, 250 UV list cap).

Example:

```json
{
  "format": "command-warfare-army",
  "version": 2,
  "name": "My Demon List",
  "list": {
    "commander": "Brimstone Herald",
    "companies": [
      {
        "officer": "Chain Warden",
        "units": [{ "name": "Cinder Skitter", "count": 3 }]
      }
    ]
  }
}
```

- **Export JSON** / **Save here** — only works if the current army is legal  
- **Import…** — name lookup + full legality check before loading  
- Still **Lock army** to use it in the match

## Army rules (prototype)

- 1 commander, at least one officer company  
- Units under each officer must fit **company capacity** (UV)  
- Same **race** as the commander  
- Total army list UV ≤ **250** (at battle lock: deploy ≤155, reserve ≤60 by default; host can change room pools in lobby; unused may hold the rest — under-fill allowed)  

## Layout

| Path | Role |
|------|------|
| `play/shared/` | Hex math, seats, army validation, game rules |
| `play/server/` | Room registry + WebSocket + SQLite card lookup |
| `play/client/` | Lobby, army builder (CardFace), board UI |

## 4P later

Create room with **Max players = 4**. Seats fill N → W → S → E. Same state machine; no rewrite required.
