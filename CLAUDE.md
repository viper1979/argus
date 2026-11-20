# Argus

Electron-Desktop-App (Windows), die parallele Coding-Agent-Sessions in eigenen Git-Worktrees startet und deren Status überwacht.

Vor dem Planen eines Features oder bei Fragen zum Umfang: [docs/konzept.md](docs/konzept.md) lesen (Domänenmodell, Statusmodell, Abläufe, MVP-Grenzen, Backlog).

## Befehle

| Zweck | Befehl |
|---|---|
| App im Dev-Modus starten | `pnpm dev` |
| Tests (Vitest) | `pnpm test` (Watch: `pnpm test:watch`) |
| Lint (ESLint, type-aware) | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Formatieren (Prettier, ohne Markdown) | `pnpm format` |
| Produktions-Build nach `out/` | `pnpm build` |

## Code-Struktur

- `src/main/`: Main-Prozess. `src/preload/`: Preload-Brücke. `src/renderer/`: React-UI. `src/shared/`: von allen Prozessen genutzt.
- **IPC:** Jeder Aufruf wird zuerst in `src/shared/ipc/contract.ts` als `domain → action → { request, response }` (zod) eingetragen. Der Kanalname `domain:action` wird abgeleitet und nie von Hand geschrieben. Main implementiert ihn in `src/main/ipc/ipc-handlers.ts`, der Renderer ruft `window.argus.<domain>.<action>()` auf. Validiert wird beides im Main-Prozess (`registerIpcHandlers`). Push vom Main zum Renderer (z. B. Terminal-Ausgabe) kommt in `ipcEventContract` als `domain → event → schema`. Main sendet über `createIpcEventEmitter`, der Renderer abonniert mit `window.argus.<domain>.on<Event>()` (ADR 0007).
- Das Preload läuft mit `sandbox: true` und darf nur `electron` per `require` laden. Deshalb bündelt electron-vite alle anderen Abhängigkeiten ins Preload (`externalizeDeps: false`).
- `node-pty` ist ein natives Modul mit N-API-Prebuild. Es läuft ohne `@electron/rebuild` in Electron, sein Build-Skript ist per `allowBuilds` in `pnpm-workspace.yaml` freigegeben. Nach einem Upgrade den Text der „File not found“-Meldung prüfen, auf dem `node-pty-spawner.ts` den Fallback auf `powershell.exe` aufbaut.
- shadcn/ui-Komponenten: `pnpm dlx shadcn@<version> add <name>`. Danach den Import von `cn` prüfen (muss `@renderer/lib/utils` sein) und kontrollieren, dass die CLI keine unerwarteten Pakete installiert hat.

## Fachsprache

[GLOSSARY.md](GLOSSARY.md) ist das verbindliche Vokabular. Docs, UI-Texte und Commit-Messages verwenden die deutschen Glossar-Begriffe; Code verwendet ausschließlich diese englischen Entsprechungen:

| Glossar | Code |
|---|---|
| Projekt | `Project` |
| Task | `Task` |
| Terminal | `Terminal` |
| Terminal-Tab | `TerminalTab` |
| WorktreeRoot | `worktreeRoot` |
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
- **Prozessgrenzen:** Der Main-Prozess besitzt PTYs, Git, Hook-Server und Persistenz. Der Renderer läuft mit `contextIsolation` ohne Node-Zugriff und spricht nur über die typisierte Preload-API; jede IPC-Nachricht vom Renderer und jeder Hook-Payload wird mit zod validiert. Events vom Main zum Renderer erzeugt der Main-Prozess selbst, sie werden nicht zur Laufzeit validiert (ADR 0007).
- **Agent-Typ-neutraler Kern:** Alles Claude-Spezifische (Startbefehl, Resume, Hook-Konfiguration, Event→Status, Terminal-Signal→Status) lebt im `AgentTypeAdapter` für Claude Code, damit Codex ohne Umbau des Kerns andockt.
- **Branches löschen mit `git branch -d`.** `git branch -D` nur nach ausdrücklicher Bestätigung durch den User in der UI (Ablauf „Task entfernen“ im Konzept). Einzige Ausnahme: Scheitert das Anlegen eines Tasks (`git worktree add` oder danach das Speichern), löscht Argus den Task-Branch mit `git update-ref -d <ref> <startcommit>`. Das löscht nur, solange der Branch noch auf dem Startcommit steht. Eigene Commits gehen so nie verloren. Hat Argus den Worktree nicht entfernen können, bleibt auch der Branch stehen (Konzept 5.2).

## Tests

Höchste Testpriorität haben die Statusregeln (Event→Status, Subagent-Zähler, „Wartet“ bleibt bis zur Auflösung, Abbruch-Erkennung über Terminal-Signale), die Pfad- und Namensbildung für Worktrees und die Branch-Lösch-Entscheidung. Testframework: Vitest.
