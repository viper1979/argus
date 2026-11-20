# Argus

Electron-Desktop-App (Windows), die parallele Coding-Agent-Sessions in eigenen Git-Worktrees startet und deren Status überwacht.

Vor dem Planen eines Features oder bei Fragen zum Umfang: [docs/konzept.md](docs/konzept.md) lesen (Domänenmodell, Statusmodell, Abläufe, MVP-Grenzen, Backlog).

## Fachsprache

[GLOSSARY.md](GLOSSARY.md) ist das verbindliche Vokabular. Docs, UI-Texte und Commit-Messages verwenden die deutschen Glossar-Begriffe; Code verwendet ausschließlich diese englischen Entsprechungen:

| Glossar | Code |
|---|---|
| Projekt | `Project` |
| Task | `Task` |
| Terminal | `Terminal` |
| Agent-Typ | `AgentType` |
| Agent-Session | `AgentSession` |
| Subagent | `Subagent` |
| Status Arbeitet / Wartet / Bereit / Fehler / Beendet | `working` / `waiting` / `ready` / `failed` / `ended` |

Ein neuer Fachbegriff oder eine geänderte Bedeutung wird im selben Change in `GLOSSARY.md` und in dieser Tabelle nachgezogen. UI-Texte sind deutsch.

## Architekturentscheidungen

[docs/adr/](docs/adr/) enthält die ADRs. Vor Änderungen an Plattform, Shell, Hook-Mechanismus oder Terminal-Lebensdauer das betroffene ADR lesen. Eine Entscheidung, die schwer umkehrbar, ohne Kontext überraschend und Ergebnis einer echten Abwägung ist, bekommt ein neues ADR (nächste Nummer, gleiches Format wie die bestehenden).

## Leitplanken

- **Nur Windows.** Jedes Terminal ist eine PowerShell (`pwsh`, Fallback `powershell.exe`) über node-pty/ConPTY; Agent-CLIs starten *in* dieser Shell (ADR 0002).
- **Claude-Hooks ausschließlich über die generierte `--settings`-Datei** mit HTTP-Hooks, nur `SessionStart` als `curl.exe`-Command-Hook; die Claude-Konfiguration des Users (`~/.claude/`) bleibt unberührt (ADR 0003). Ein Abbruch per Escape/Strg+C wird über Tastendruck + Terminal-Titel erkannt (ADR 0005).
- **Prozessgrenzen:** Der Main-Prozess besitzt PTYs, Git, Hook-Server und Persistenz. Der Renderer läuft mit `contextIsolation` ohne Node-Zugriff und spricht nur über die typisierte Preload-API; jede IPC-Nachricht und jeder Hook-Payload wird mit zod validiert.
- **Agent-Typ-neutraler Kern:** Alles Claude-Spezifische (Startbefehl, Resume, Hook-Konfiguration, Event→Status, Terminal-Signal→Status) lebt im `AgentTypeAdapter` für Claude Code, damit Codex ohne Umbau des Kerns andockt.
- **Branches löschen mit `git branch -d`.** `git branch -D` nur nach ausdrücklicher Bestätigung durch den User in der UI (Ablauf „Task entfernen“ im Konzept).

## Tests

Höchste Testpriorität haben die Statusregeln (Event→Status, Subagent-Zähler, „Wartet“ bleibt bis zur Auflösung, Abbruch-Erkennung über Terminal-Signale), die Pfad- und Namensbildung für Worktrees und die Branch-Lösch-Entscheidung. Testframework: Vitest.
