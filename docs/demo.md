# Demo and verification

## Software checks

With Node 24:

```bash
npm run db:setup
npm run stream:install
npm test
npm run build
npm start
```

Tests cover SQLite storage/migrations and seed idempotence, concurrent reservations, validation, launch failures, natural exit and restart recovery, owned-process cleanup, real WebSocket forwarding, request-origin checks, rejection of a second player, stream reconnect, and private-display environment forwarding. Test fixture servers exercise integration behavior; they do not simulate verified game video.

## Browser demonstration

1. Open the configured website. Confirm the host is available and SuperTuxKart, Xonotic, SuperTux, and OpenTTD are listed.
2. Click Play. Confirm the session page opens its embedded Selkies player and shows actual game video. No pairing or client installation is needed.
3. On a fresh runtime, complete the game's offline player setup using browser mouse/keyboard. This is game setup, not an application account.
4. Start a tutorial/race. Hold Up to accelerate and use Left/Right to steer. Confirm the kart and scene respond in the streamed video.
5. Click Fullscreen or enter Selkies Gaming Mode. Hold Escape to release capture. Game-specific Escape handling can also open menus or leave the game.
6. Use Reconnect. Confirm video returns to the same game/session without allocating another host reservation.
7. Click End Session. Confirm the stream disappears, the game process stops, and the host becomes available. Start and end another session.
8. Repeat from a second LAN device over trusted HTTPS. Confirm audible sound, controls, latency, and connection stability. Physical gamepads require a separate device check.

## Observed on this host

SuperTuxKart has been streamed in the real browser player on a dedicated Selkies Wayland display. Mouse clicks and typed keyboard input reached the game; browser keyboard acceleration moved the kart during the tutorial. Selkies reported GPU rendering and zero-copy AMD VA-API H.264 capture. The server reported non-silent audio capture and Opus encoding. Do not treat those logs as an audible playback check; verify sound on the client separately. Second-device network behavior and physical gamepads remain manual checks.

The three additional titles have also been launched through the website with video received in the browser, followed by End Session cleanup. First-run terms, network, and survey prompts are left for the player to answer. Full gameplay, audible playback, and gamepad checks for these titles remain manual.

Mahjongg is the touch-first title: open its details, press Play, rotate the phone to landscape, keep Touch mode enabled, and tap two matching free tiles. Switch to Trackpad for indirect pointer movement if preferred. Audio uses Selkies' generated AudioWorklet; the player CSP explicitly permits its data: module. The visible Sound and Game volume controls use Selkies' supported message API. Tap inside the game once if the browser waits for an audio gesture. Mahjongg is a quiet puzzle; use SuperTuxKart to check audible output.

## Two simultaneous games

Use two devices or separate browser profiles. Start SuperTux on device A and Mahjongg on device B; check that the header shows 2/2 slots. Confirm different pictures and independent input. End A: B must keep playing, and the header must show 1/2. Start another title on A. Reconnect A and verify B is unaffected. Repeat an audible check on both clients with different sound-producing titles. The same title is intentionally limited to one live copy.

Verified on this host: SuperTux and Mahjongg ran concurrently on two separate Selkies displays; both browser players rendered their own title. Ending SuperTux left Mahjongg rendering and accepting tile input. Distinct runtime sockets and D-Bus sessions isolate the audio services. Physical two-device latency and simultaneous audible speaker playback remain client checks.

Audio isolation was also checked by recording both private PulseAudio monitors while sending a test tone only to slot 1: slot 1 measured nonzero PCM, while slot 2 remained silent. This checks server routing, independently of physical client speakers. The full integration suite contains 34 passing tests.
