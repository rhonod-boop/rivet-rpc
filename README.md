# Rivet — Discord Rich Presence (beta)

A small Windows desktop app that puts **any** text, image, buttons and party into your Discord
presence — same idea as [Discord-CustomRP](https://github.com/maximmax42/Discord-CustomRP),
built with TypeScript, Electron and the maintained
[`@xhayper/discord-rpc`](https://github.com/xhayper/discord-rpc) fork of
[discord-rpc](https://github.com/discord/discord-rpc).

It opens with a **beta warning**, keeps a live Discord-style preview next to the form, and
remembers your settings between launches. The preview is your own account: name and avatar come
from the Discord client over the same handshake that sets the presence, and are cached so they
are there before you reconnect.

**[Download the latest build](https://github.com/rhonod-boop/rivet-rpc/releases/latest)** — installer or
portable exe. **[Join the Rivet Discord](https://discord.gg/dkDhWNYY4Z)** for builds, bug reports and presets.

## What it does

- Connects to the local Discord IPC socket — no bot token, no account credentials.
- Shows the signed-in account's display name and avatar, read off the handshake.
- Sets activity type — Playing, Streaming, Listening, Watching or Competing — plus name,
  details/state (+ optional click-through URLs), timestamps, large/small images (asset key
  **or** direct `https://` URL), party size and up to two buttons.
- Auto-reconnects with backoff if Discord restarts, and clears the presence on disconnect/quit.
- Validates input before sending so Discord doesn't silently drop the activity.

## Install

Two artifacts ship from `release/`:

| File | What it is |
| --- | --- |
| `Rivet-<version>-Setup.exe` | Installer (per-user, no admin). **Recommended** — starts instantly after install. |
| `Rivet-<version>-portable.exe` | Single file, no install. Unpacks to a cached folder on first run. |

Both are unsigned, so SmartScreen may show "unknown publisher" on first launch
(More info → Run anyway).

**Why the portable build felt slow:** a portable Electron exe has to unpack ~110 MB into a temp
folder every time it starts. Rivet now unpacks to a fixed, reused folder (`RivetRPC`), so only
the first launch pays for it. The installer skips unpacking entirely, which is why it opens in
about a second.

## Requirements

- Windows 10/11, 64-bit.
- The **Discord desktop app** running and signed in (browser/mobile can't host RPC).
- Your own Discord **application ID** — create one free at
  <https://discord.com/developers/applications>. The app's name and uploaded rich-presence assets
  are what Discord shows.

## Run from source

```bash
npm install
npm run icon       # rasterises build/icon.svg -> icon.png + icon.ico (needs Electron)
npm start          # builds with esbuild, then launches Electron
npm run dev        # rebuild in watch mode, then `npx electron .` in a second shell
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit
npm run pack       # portable .exe           -> release/
npm run dist       # installer + portable    -> release/
```

## Layout

```
src/
  shared/types.ts     config + IPC types shared by all processes
  main/main.ts        Electron window, IPC handlers, input normalisation
  main/rpc.ts         RPC client lifecycle, activity building, reconnect logic
  preload/preload.ts  contextBridge API (contextIsolation on, sandboxed)
  renderer/           index.html, styles.css, app.ts (form + live preview + beta modal)
build/icon.svg        the R mark; `npm run icon` turns it into PNG/ICO
scripts/make-icon.cjs Electron renderer for the icon set
scripts/build.mjs     esbuild bundling + asset copy
```

## Notes / known beta issues

- Discord's client refuses the streaming type over RPC (`"type" must be one of [0, 2, 3, 5]`), so a
  Streaming selection is sent as Playing with your Twitch/YouTube link attached as a **Watch
  stream** button — when a button slot is free. The form says `sent as playing` when you pick it.
- Timestamps don't tick on Discord's side for custom ranges; press **Update** after editing.
- Buttons may not render for every account/client — Discord decides per app trust level.
- External image URLs must be direct links; some CDNs refuse Discord's proxy.
- If the presence goes stale after a Discord update, reconnect once (Rivet retries automatically).

No account tokens are stored. Your client ID and form values live in `localStorage` inside the
Electron profile (`%APPDATA%/Rivet`). The public profile Discord reports on connect (id, handle,
display name, avatar URL) is cached in `profile.json` beside it, only so the preview can show you
before connecting.

## Publishing a release

```bash
git init && git add . && git commit -m "Rivet 1.1.0"
gh repo create rivet-rpc --public --source=. --push
gh release create v1.1.0 release/Rivet-1.1.0-Setup.exe release/Rivet-1.1.0-portable.exe \
  --title "Rivet 1.1.0" --notes-file RELEASE_NOTES.md
```

MIT licensed.
