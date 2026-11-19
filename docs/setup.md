# Setup

## Requirements

Use Node 24, npm, Linux x86_64, `dbus-run-session`, `openssl` for optional local TLS generation, and `/usr/bin/supertuxkart`. SuperTuxKart is already installed on this machine; on another Arch host install it with `sudo pacman -S --needed supertuxkart`. The host needs working Mesa/GPU drivers and `libwayland-server`. Selkies’ AppImage supplies its server, browser client, capture/encoding libraries, and private PulseAudio server.

The app starts one **private headless Wayland display**, private D-Bus session, and PulseAudio server per gaming slot and launches each player’s game on its assigned display. It does not change the user's desktop configuration or require a visible host game window. The display/audio sockets live under `.runtime/selkies/seats/`; per-device game settings and saves live under `.runtime/players/`. No Sunshine or Moonlight service is used by this implementation.

## Install and configure

From the project root with Node 24:

```bash
npm ci
cp .env.example .env
npm run db:setup
npm run stream:install
npm run games:install
npm run build
npm start
```

Keep an existing `.env` if it is already configured. Run as the ordinary desktop user with access to the GPU render node; do not run the app as root. Stop the app before replacing the Selkies installation. The installer verifies Selkies 2.2.1 against SHA-256 `404dc07d6d0fe2de9b20646e352484cb22b636e083397ff8850907307d2f250e` and extracts through a staging directory.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Local SQLite URL; relative paths resolve from `backend/`. Default `file:./prisma/dev.db`. |
| `BIND_ADDRESS` | Website loopback or private IPv4 address; public/wildcard bindings are rejected. |
| `PORT` | Website port, default `3001`. |
| `SITE_ORIGIN` | Exact browser origin without a trailing slash. |
| `HOST_ADDRESS` | Gaming host address displayed in the session. |
| `SELKIES_PORT` | First private loopback port, default `8082`. Each slot uses the next port; this range must not overlap `PORT`. |
| `MAX_SESSIONS` | Simultaneous independent games, default `2`, supported range `1`–`4`. Set according to available GPU/CPU/RAM. |
| `SELKIES_HOST_DRM` | Default `true`: preload available host libdrm libraries into Selkies so the host's Mesa driver uses its matching ABI. Set `false` to use bundled libraries if necessary. |
| `TLS_CERT_PATH`, `TLS_KEY_PATH` | Optional website certificate/key, relative to `backend/`; set both together. |

Use one backend and one database on the gaming host. The committed migrations include slot, device, and active-title uniqueness guards: use `npm run db:setup`, not `prisma db push`. Prisma maintains migration metadata in addition to the Game and Session application tables. After a hard crash, wait at least ten seconds before restarting so the singleton lock can become stale. Close any surviving unowned game manually.

## Game library

The seed adds SuperTuxKart, Xonotic, SuperTux, OpenTTD, and the touch-friendly Mahjongg. On Arch, install SuperTuxKart and Xonotic with `sudo pacman -S --needed supertuxkart xonotic`. `npm run games:install` downloads checksum-pinned Arch packages for SuperTux, OpenTTD, Mahjongg, their additional libraries, OpenGFX, and OpenSFX into `.runtime/games/`; it does not require root or modify system packages. This bundle requires an Arch-compatible x86_64 host and `curl`/`bsdtar`. Stop the backend before updating it. New device profiles and saves persist in `.runtime/players/`; existing single-player profiles remain in `.runtime/games/` and `.runtime/selkies/`. Run `npm run db:seed -w backend` after updating the catalog; existing IDs, sessions, and enabled flags are preserved.

Xonotic and OpenTTD use keyboard and mouse. Xonotic may present a first-run terms/privacy choice for optional online services; the player makes that choice in the game. OpenTTD includes free graphics and sound effects; background music is not bundled.

## LAN HTTPS

Loopback HTTP is a browser secure context and works for testing on the host. For another device, use **trusted HTTPS** so WebCodecs and full keyboard/gamepad features are available. The packaged Selkies client rejects insecure remote HTTP connections; JPEG does not bypass this requirement.

For example:

```dotenv
BIND_ADDRESS=192.168.1.50
HOST_ADDRESS=192.168.1.50
PORT=3001
SITE_ORIGIN=https://192.168.1.50:3001
TLS_CERT_PATH=../.runtime/tls/cert.pem
TLS_KEY_PATH=../.runtime/tls/key.pem
SELKIES_PORT=8082
```

Replace the IP with the host's actual private address. Supply a certificate trusted by the client, or run `npm run tls:generate` for a local 30-day demo certificate. That helper refuses to overwrite existing files, prints a fingerprint-inspection command, and does not change system trust. Review and trust a local certificate yourself on each client. Restart after changing `.env`.

Only the website port is needed from the trusted LAN: Express proxies the WebSocket stream. Keep Selkies bound to loopback. There is no account isolation or authentication in this prototype; do not expose the website publicly. No router forwarding, TURN server, Docker, or Kubernetes is required for the selected transport.

## Controls and lifecycle

Click Play, then click inside the player if the browser needs an interaction to enable audio/input. Selkies' toolbar includes fullscreen and Gaming Mode. Gaming Mode uses Ctrl+Shift+X; hold Escape to release capture. Some operating-system shortcuts remain browser/OS controlled. Reconnect closes the old player socket and keeps the same game; End Session closes the socket and terminates only the app-owned game process group.

The backend's READY status describes the game process. The browser's video status comes from Selkies' documented stats messages and observed rendering fps; process launch alone is not evidence of a working stream. One proxied player socket is admitted per session; different devices route to different private services.

## Troubleshooting

- **Selkies unavailable:** run `npm run stream:install`, then restart. Inspect `.runtime/selkies/server.log` for startup, display, audio, and encoder errors.
- **Port busy:** stop the earlier test/backend or change `SELKIES_PORT`. The app refuses to adopt an unowned service.
- **Mesa/AMD undefined symbol:** retain `SELKIES_HOST_DRM=true`. This host needs its own libdrm alongside its current Mesa driver; no system library files are replaced.
- **Game failed:** inspect backend logs and confirm the installed game supports SDL Wayland. The approved executable/arguments are in `backend/src/services/launcher.js`; request bodies cannot supply commands.
- **Audio missing:** click inside the player and inspect its audio toggle. The game uses a private output sink, captured as Opus. This never redirects the user's ordinary desktop sound server.
- **Poor video on another device:** check trusted HTTPS, browser decoding support, and the host encoder shown by Selkies. Start on a recent Chromium browser.
- **Input capture:** click the video, use Gaming Mode when needed, and hold Escape to release. Physical gamepad verification is separate from keyboard/mouse testing.
- **Origin rejected:** open exactly `SITE_ORIGIN`. Development uses `http://127.0.0.1:5173`, TLS unset. Production uses the Express origin.
- **Cleanup failed:** the reservation stays held; retry End Session. The app never kills an existing unrelated process.

References: [Selkies native installation](https://docs.selkies.io/latest/native/), [browser client](https://docs.selkies.io/latest/components/web-client/), [usage](https://docs.selkies.io/latest/usage/).

## Independent LAN players

Open the HTTPS site on two different devices (or different browser profiles), choose different games, and press Play. Each gets its own screen, controls, and audio. The header shows occupied/total slots. A regular browser shares its device cookie across tabs, so two tabs resume the same session. Clearing cookies loses that browser’s session ownership until backend restart; use End Session before clearing site data. Restart fails interrupted records and releases their slots after owned-process shutdown. The prototype has no accounts or host-wide session management UI.

`MAX_SESSIONS=2` prewarms two stream services on loopback ports 8082–8083. Only website port 3001 needs LAN firewall access. This is process/display/audio separation within the same Linux user, not a VM/container security boundary. Keep it on a trusted LAN. GPU encoding capacity and performance must be checked with the games and devices you use.
