# Rivet 1.1.0 — first public build

Rivet is a Windows app for setting a fully custom Discord Rich Presence: text, images,
timestamps, party size and up to two buttons, with a live preview of your own profile.

**Community:** https://discord.gg/dkDhWNYY4Z

## Downloads

- `Rivet-1.1.0-Setup.exe` — installer, recommended (starts in about a second)
- `Rivet-1.1.0-portable.exe` — single file, no install (unpacks once, then reuses the folder)

## What's new

- New name and identity: **Rivet**, with the R mark as app and window icon.
- Rebuilt interface: indexed sections, a Discord-accurate preview card, amber primary action
  and a sidebar with the community invite.
- Streaming selection no longer errors. Discord rejects the streaming type over RPC, so Rivet
  sends Playing with your Twitch/YouTube link as a **Watch stream** button.
- Much faster startup: the portable build caches its unpacked files, English-only locales, and
  the renderer now caches compiled JS.

## Known issues

- Discord desktop must be running and the app must have its own application ID.
- Buttons are shown at Discord's discretion and can be hidden for newer accounts.
- Build is unsigned, so SmartScreen may warn on first launch.
