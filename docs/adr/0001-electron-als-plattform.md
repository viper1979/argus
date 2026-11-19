---
status: accepted
date: 2026-11-19
---

# Electron als Plattform

Argus wird als **Electron-Desktop-App** (TypeScript, React) gebaut, nicht als lokale Web-App mit Node-Server und Browser-Oberfläche. Ausschlaggebend ist das Nutzungsgefühl einer echten Desktop-App (eigenes Fenster, Tray, native Notifications). Außerdem lassen sich Kollegen später per Installer versorgen. Der Mehraufwand gegenüber der Web-App (IPC-Schicht, Preload-Brücke, Packaging, `node-pty` gegen die Electron-ABI bauen) wird bewusst in Kauf genommen.

## Considered Options

- **Lokale Web-App** (Node + React im Browser): weniger Overhead, Zugriff vom Handy fast geschenkt. Verworfen, weil sie sich nicht wie ein eigenständiges Tool anfühlt.
- **Tauri**: kleiner und schneller, aber Rust als zweite Sprache und kein `node-pty`.
- **.NET (Avalonia/WPF)**: Haupt-Stack des Autors, aber das Ökosystem für Terminal-Emulation ist deutlich dünner als xterm.js + node-pty.
