---
status: accepted
date: 2026-11-20
---

# Terminal-Streams per IPC-Events, Terminal-Inhalt lebt in xterm.js im Renderer

Der IPC-Vertrag kannte bis #5 nur Request/Response (`invoke`). Terminals brauchen zusätzlich Push vom Main-Prozess zum Renderer: Ausgabe und Prozessende. Außerdem muss der Inhalt eines Terminals einen Wechsel zwischen Tasks überstehen.

**Events im Vertrag.** Neben `ipcContract` gibt es `ipcEventContract` (`domain → event → zod-Schema`). Der Kanalname `domain:event` wird wie bei den Aktionen abgeleitet. Der Main-Prozess sendet über einen typisierten Emitter (`createIpcEventEmitter`) per `webContents.send`, und zwar nur an das eigene Fenster. Im Renderer erscheint jedes Event als `window.argus.<domain>.on<Event>(listener)`. Der Aufruf liefert eine Abmeldefunktion. Das Preload reicht nur die Payload durch, nie das Electron-Event-Objekt. Eingabe und Resize bleiben normale `invoke`-Aktionen (`terminal.write`, `terminal.resize`). Damit gelten zod-Validierung und Absenderprüfung (`registerIpcHandlers`) unverändert. Die Reihenfolge der Tastendrücke bleibt erhalten, weil der Handler synchron schreibt.

**Keine Laufzeitvalidierung der Events.** Das ist eine bewusste Ausnahme von der Leitplanke „jede IPC-Nachricht wird mit zod validiert“. Die Leitplanke gilt deshalb für Nachrichten vom Renderer. Event-Payloads erzeugt der Main-Prozess selbst, und Ausgabe-Chunks kommen zu häufig für eine Schema-Prüfung pro Chunk. Die Schemas im Event-Vertrag dienen der Typableitung.

**Inhalt in xterm.js.** Jedes Terminal hat genau eine xterm.js-Instanz im Renderer. Sie lebt außerhalb von React, so lange wie der Prozess. Beim Wechsel von Task oder Tab wird nur ihr Host-Element aus der Seite gehängt, die Instanz nimmt weiter Ausgabe an. Der Main-Prozess puffert keine Ausgabe. Nur die Ausgabe, die die Antwort auf `terminal.open` überholt, hält der Renderer kurz fest (`TerminalOutputRouter`).

## Considered Options

- **Fire-and-forget für Eingabe** (`ipcRenderer.send`/`ipcMain.on`): etwas schneller, braucht aber einen zweiten Registrierungspfad mit eigener Validierung und Absenderprüfung. Lokales `invoke` kostet unter 1 ms.
- **MessagePort je Terminal:** am schnellsten, aber außerhalb des Vertrags. Validierung und Absenderprüfung müssten neu gebaut werden.
- **Puffer im Main mit Replay:** übersteht ein Neuladen des Renderers. Ein Replay in anderer Spaltenbreite verstümmelt aber TUI-Ausgaben wie die von Claude Code, und ein begrenzter Puffer schneidet den Anfang ab.
- **`@xterm/headless` mit Serialize-Addon im Main:** liefert den exakten Zustand auch nach einem Reload. Kostet zwei Abhängigkeiten und doppeltes Parsen jeder Ausgabe.

## Consequences

- Wird der Renderer neu geladen (praktisch nur im Dev-Modus), ist der sichtbare Inhalt der Terminals weg. Die Prozesse laufen weiter, ihre Tabs fehlen aber, bis es eine Wiederherstellung gibt. Kommt das im Alltag vor, ist `@xterm/headless` der Ausweg, ohne den Vertrag zu ändern.
- Event-Namen dürfen nicht wie Aktionen derselben Domain heißen, weil beide auf `window.argus.<domain>` landen.
- Speicher: Der Scrollback (5000 Zeilen) liegt pro Terminal im Renderer.
- Die Agent-Session (#7) nutzt denselben Weg. Ihr Tab ist ein Terminal mit anderem Startbefehl.
- Endet eine Shell, bevor die Antwort auf `terminal.open` im Renderer ankommt, bekommt sie keinen Terminal-Tab. Der Renderer merkt sich beendete Terminals.
- Grenzen beim Beenden:
  - Ab dem Beenden lehnt `terminal.open` neue Terminals ab (`app-closing`), auch eines, dessen Anfrage schon unterwegs war. Sonst würde eine Shell, die erst danach startet, Argus überleben.
  - Argus hält das Beenden der App an (`before-quit`), bis jedes PTY sein Ende gemeldet hat. Dabei wartet es pro Terminal höchstens 5 s. Meldet ein Prozess sein Ende nicht, gibt Argus auf, damit Schließen und Beenden nicht hängen. Ein solcher Prozess kann übrig bleiben. Im Smoke-Test von #5 trat das nicht auf: Shell und darin laufende Programme (`ping -t`, `node`) endeten beim Schließen des Tabs.
  - Bei einem Absturz, bei `app.exit()` oder bei Strg+C im Dev-Modus feuert `before-quit` nicht. Ob ConPTY die Shells dann beendet, ist nicht geprüft.
