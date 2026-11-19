# Orbit — Browser Cloud Gaming

Open the website, choose a game, and play in the browser. Each player gets a dedicated private Linux display and audio server. **Selkies 2.2.1 supplies the streaming server and browser client**; React, Express, SQLite, and Prisma manage the library, game process, and device-owned gaming slots.

## Run

Use **Node 24** (`.node-version` pins 24.15.0), npm, and Linux x86_64 with SuperTuxKart installed:

```bash
npm ci
cp .env.example .env
npm run db:setup
npm run stream:install
npm run games:install
npm run build
npm start
```

Keep an existing configured `.env` instead of replacing it. Open `SITE_ORIGIN`, default [http://127.0.0.1:3001](http://127.0.0.1:3001). Click Play. The backend launches the game on Selkies’ private Wayland display and opens the packaged player automatically. No Sunshine pairing or native client setup is part of this flow.

Click inside the player for keyboard/mouse and audio. The Selkies toolbar provides Gaming Mode, input, and audio controls. End Session disconnects the player, stops the owned game process group, and releases the host. Reconnect replaces the player connection while keeping the same game running.

```bash
npm test
npm run build
```

Development: set `BIND_ADDRESS=127.0.0.1`, `SITE_ORIGIN=http://127.0.0.1:5173`, and leave TLS variables unset, then run `npm run dev`. Vite proxies API and WebSocket traffic to Express.

## Architecture

- React + Vite + Tailwind: library, game details, and session with an embedded Selkies player.
- Express: approved game launch/stop, database access, and a standard HTTP/WebSocket proxy to loopback Selkies.
- Prisma + SQLite: the two application tables and partial unique indexes protecting each slot, device, and active title.
- Selkies: private Wayland compositor, capture, encoding, audio, browser playback, and input forwarding. The application does not implement a streaming engine.
- One backend instance and one gaming host, with two independent gaming slots by default (configurable from 1 to 4). Each browser has one session; each title runs once at a time. The backend owns only the processes and connections it creates.

The current transport is Selkies’ default **WebSockets**, at 1280×720 and 60 fps requested. H.264 uses host GPU encoding where available. HTTPS is required for browser streaming on another LAN device. Loopback HTTP works on the host. See [setup](docs/setup.md) and [demo/verification](docs/demo.md).

## Dependency and verification

The installer downloads the official Linux x86_64 Selkies AppImage, verifies its pinned SHA-256, and extracts its packaged server and client under ignored `.runtime/selkies/`. It changes no system packages. `npm start` starts and supervises Selkies; Ctrl+C cleans it up. Game settings and audio are scoped to that runtime directory, separate from the everyday desktop.

Upstream: [Selkies 2.2.1](https://github.com/selkies-project/selkies/tree/2.2.1), MPL-2.0 with separately licensed bundled components. License/source information travels in the release; see the upstream licensing documentation before redistributing a bundle.

Verified here: actual browser video, keyboard and mouse input, fullscreen, and hardware H.264 capture on AMD VA-API. Audio capture/Opus encoding has been observed in runtime logs; audible playback and gamepad hardware still need a human/device check. Automated tests exercise real temporary SQLite databases and HTTP/WebSocket fixture servers; those fixtures do not substitute for gameplay verification.
