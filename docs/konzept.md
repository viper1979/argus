# Argus – Konzept

> **Zielbild**
> Eine Windows-Desktop-App, mit der ich **mehrere Coding-Agents parallel** über **mehrere Repositories** hinweg starte und beobachte. Jede Aufgabe läuft isoliert in einem eigenen **Git-Worktree**. Ich sehe auf einen Blick, welche Agent-Session **arbeitet**, welche **auf mich wartet** und welche **bereit** ist. Primär ein persönliches Tool, das später auch Kollegen nutzen können.

> **Name**
> **Argus** steht für **A**gent **R**un **G**overnance & **U**nified **S**upervision. In der griechischen Mythologie ist *Argus Panoptes* der Riese mit hundert Augen, der nie alle gleichzeitig schließt. Genauso behält das Tool alle Agent-Sessions im Blick. Repo: `argus`.

Inspiriert von der Analyse von Orca, aber bewusst deutlich schlanker:
- [Orca](https://github.com/stablyai/orca) (MIT): Tech-Stack, Status-Erkennung über Claude-Code-Hooks, Worktree-Lifecycle. Die ausführlichen Analyse-Notizen liegen außerhalb dieses Repos.

Begriffe: [Glossar](../GLOSSARY.md) · Entscheidungen: [docs/adr](adr/)

## 1. Rahmenbedingungen

| Thema | Entscheidung | Quelle |
|---|---|---|
| Nutzer | Primär ich, später an Kollegen verteilbar (Installer, keine hartkodierten Pfade) | – |
| Plattform | Electron-Desktop-App | [ADR 0001](adr/0001-electron-als-plattform.md) |
| Betriebssystem | Zunächst nur Windows; jedes Terminal ist eine PowerShell | [ADR 0002](adr/0002-zunaechst-nur-windows.md) |
| Agent-Typen | Claude Code im MVP, Codex muss später ohne Umbau ergänzbar sein | – |
| Interaktion | Echtes Terminal (PTY), keine eigene Chat-Oberfläche | – |
| Status-Erkennung | Claude-Hooks per `--settings` als HTTP-Hooks (nur `SessionStart` als `curl.exe`-Command-Hook), globale Settings bleiben unberührt | [ADR 0003](adr/0003-hooks-per-settings-flag-und-http.md) |
| Abbruch-Erkennung | Escape bzw. Strg+C plus Leerlauf-Glyphe im Terminal-Titel, weil Claude dafür kein Hook-Event sendet | [ADR 0005](adr/0005-abbruch-ueber-tastendruck-und-terminal-titel.md) |
| Orchestrierung | Nur ich starte Agent-Sessions; Subagents der Agents sind erlaubt | – |
| Lebensdauer | Terminals enden mit der App, Agent-Sessions sind per `--resume` fortsetzbar | [ADR 0004](adr/0004-kein-hintergrunddienst-fuer-terminals.md) |
| Git-Abschluss | Argus macht kein Commit, Push oder PR; das erledigt die Agent-Session oder ich | – |

## 2. Domänenmodell

```mermaid
classDiagram
    direction LR
    Projekt "1" --> "*" Task
    Task "1" --> "0..*" AgentSession : höchstens eine läuft
    Task "1" --> "*" Terminal
    AgentSession --> AgentTyp
    AgentSession "1" --> "*" Subagent : zählt nur

    class Projekt {
      Name
      Repo-Pfad
      Haupt-Branch
      Branch-Präfix
      Default-Agent-Typ
      Setup-Skript (lokal)
    }
    class Task {
      Name
      Branch
      Basis-Branch
      Worktree-Pfad
      Start-Prompt
    }
    class AgentSession {
      Agent-Typ
      Status
      Konversations-ID
      Anzahl aktiver Subagents
    }
    class Terminal {
      Titel
    }
```

**Kernregeln**
- Ein **Task** hat genau **einen Worktree** und **einen Branch**. Er gehört zu genau einem **Projekt**.
- In einem Task läuft **höchstens eine Agent-Session** gleichzeitig. Daneben gibt es beliebig viele **Terminals**.
- Eine **Agent-Session** ist eine *Konversation*, kein Prozess. `--resume` setzt *dieselbe* Agent-Session fort.
- Den **Agent-Typ** wähle ich pro Agent-Session. Default ist der Agent-Typ des Projekts.
- **Subagents** startet die Agent-Session selbst. Argus zählt sie nur.
- Projekte gruppieren Tasks in der Sidebar nur *virtuell*, sie haben keinen eigenen Zustand.

## 3. Statusmodell einer Agent-Session

```mermaid
stateDiagram-v2
    [*] --> Bereit: SessionStart
    Bereit --> Arbeitet: UserPromptSubmit
    Arbeitet --> Wartet: PermissionRequest / AskUserQuestion
    Wartet --> Arbeitet: PostToolUse / PostToolUseFailure / UserPromptSubmit
    Arbeitet --> Bereit: Stop
    Arbeitet --> Bereit: Abbruch (Escape/Strg+C + Titel ✳)
    Arbeitet --> Fehler: StopFailure
    Fehler --> Arbeitet: UserPromptSubmit
    Bereit --> Beendet: SessionEnd (außer clear)
    Fehler --> Beendet: SessionEnd (außer clear)
    Wartet --> Beendet: SessionEnd (außer clear)
    Arbeitet --> Beendet: SessionEnd (außer clear)
    Beendet --> Bereit: Fortsetzen (--resume, SessionStart)
```

Beim Start mit Prompt folgt auf `SessionStart` direkt `UserPromptSubmit`, gemessen nach etwa 0,3 s. **Bereit** ist dann nur ein kurzer Zwischenstand. Toasts gibt es deshalb nur beim Übergang *aus* **Arbeitet** oder **Wartet**. **Bereit** nach `SessionStart` löst keinen Toast aus.

| Status | Bedeutung | Darstellung |
|---|---|---|
| **Arbeitet** | mitten in einem Turn | blau, animiert |
| **Wartet** | braucht mich: Freigabe oder Rückfrage | orange + Toast |
| **Bereit** | Turn abgeschlossen, Ergebnis prüfbar | grün + Toast |
| **Fehler** | Turn durch Fehler abgebrochen | rot + Toast |
| **Beendet** | Prozess läuft nicht mehr, fortsetzbar | grau |

### Regeln für die Auswertung (Lehren aus Orca)

1. **Subagents verfälschen den Status nicht.** Events mit `agent_id` (also von Subagents) ändern den Status der Agent-Session nicht. `SubagentStart` und `SubagentStop` erhöhen bzw. senken nur den Zähler. Das Ende eines Subagents setzt die Agent-Session nie auf **Bereit**.
   - Der Zähler führt eine **Menge von `agent_id`s**. `SubagentStop` entfernt nur IDs, deren `SubagentStart` er gesehen hat. Nach Turns mit Tool- oder Subagent-Aufrufen meldet Claude ein `SubagentStop` Claude-interner Hilfsagents (leerer `agent_type`, kein `SubagentStart`). Diese zählen nicht als Subagent, und ein einfacher Zähler würde dadurch negativ.
   - Subagents laufen asynchron. Der Haupt-Agent meldet `Stop` (→ **Bereit**), *während* der Subagent noch läuft. Dessen Ergebnis kommt als synthetisches `UserPromptSubmit` (`<agent-message …>`) zurück, also **Arbeitet**, gefolgt von einem zweiten `Stop`. Der Zähler in der Sidebar zeigt, dass noch Subagents laufen.
2. **„Wartet“ ist sticky.** Ein `PreToolUse` eines anderen Tools oder Subagents hebt **Wartet** nicht auf. Erst `PostToolUse`/`PostToolUseFailure` des Haupt-Agents, ein neuer Prompt oder `Stop` lösen es auf.
3. **`AskUserQuestion`** kommt als `PreToolUse` an, bedeutet aber **Wartet**.
4. **Abbruch durch mich** (Escape bzw. Strg+C): Claude sendet *kein* Event. Argus erkennt den Abbruch am Tastendruck plus Leerlauf-Glyphe `✳` im Terminal-Titel und setzt **Bereit** ([ADR 0005](adr/0005-abbruch-ueber-tastendruck-und-terminal-titel.md)). Ein offenes `PreToolUse` bleibt dabei ohne `PostToolUse`. Ob das auch aus **Wartet** heraus greift, ist noch ungetestet.
5. **Beendet** wird über `SessionEnd` erkannt. Das kommt bei `/exit` und bei zweimal Strg+C im Leerlauf (`reason: prompt_input_exit`). Ein `/exit`, das *während* der Arbeit eingegeben wird, führt Claude nicht aus. Endet die PTY (z. B. beim Schließen der App), kommt `SessionEnd` mit `reason: other`. Das PTY selbst endet bei `/exit` nicht, weil die PowerShell mit `-NoExit` weiterläuft.
6. **`/clear`** meldet `SessionEnd` (`reason: clear`) und sofort `SessionStart` (`source: clear`) mit einer **neuen** `session_id`. Die Agent-Session bleibt dieselbe: Status **Bereit**, Subagent-Zähler leeren, neue Konversations-ID merken. Ein `SessionEnd` mit `reason: clear` führt deshalb **nicht** zu **Beendet**.

## 4. Architektur

```mermaid
flowchart LR
    subgraph Renderer [Renderer · React]
        Sidebar
        TaskView[Task-Ansicht<br/>Tabs + xterm.js]
    end
    subgraph Main [Main-Prozess · Node]
        ProjectService
        TaskService
        WorktreeService[WorktreeService<br/>git CLI]
        TerminalService[TerminalService<br/>node-pty]
        HookServer[HookServer<br/>127.0.0.1]
        StatusTracker
        Store[(state.json)]
        AgentAdapter[AgentTypeAdapter<br/>ClaudeCodeAdapter]
    end
    Renderer <-- IPC --> Main
    TerminalService --> PS[pwsh + claude]
    PS -- HTTP-Hooks --> HookServer
    HookServer --> AgentAdapter --> StatusTracker
    StatusTracker --> Renderer
    TaskService --> WorktreeService
    TaskService --> TerminalService
    ProjectService --> Store
    TaskService --> Store
```

### Tech-Stack

Wie Orca, auf das Nötige reduziert:

| Bereich | Technologie |
|---|---|
| Shell/Build | Electron + `electron-vite`, `electron-builder` (später Installer) |
| Sprache | TypeScript (strict) |
| UI | React, Tailwind CSS, shadcn/ui, lucide-react |
| State (UI) | Zustand |
| Terminal | xterm.js (Renderer) + node-pty mit ConPTY (Main) |
| Validierung | zod für IPC-Nachrichten und Hook-Payloads |
| Persistenz | JSON-Datei unter `%APPDATA%\Argus\state.json` |
| Tests | Vitest |

### Module im Main-Prozess

| Modul | Verantwortung |
|---|---|
| `ProjectService` | Projekte registrieren, Einstellungen pro Projekt |
| `TaskService` | Tasks anlegen und entfernen, koordiniert Worktree und Terminals |
| `WorktreeService` | `git worktree add/remove`, Branch löschen, Prüfung „geändert/ungepusht“ |
| `TerminalService` | PTYs erzeugen, Ein- und Ausgabe zum Renderer streamen, beenden. Reicht Tastendrücke und Titeländerungen (OSC 0) als Terminal-Signale weiter |
| `HookServer` | HTTP auf `127.0.0.1:<port>`, prüft das Token, nimmt Hook-Events an |
| `AgentTypeAdapter` | **Schnittstelle pro Agent-Typ**: Startbefehl, Resume-Befehl, Hook-Konfiguration, Event → Status, Terminal-Signal → Status (Abbruch-Erkennung) |
| `StatusTracker` | hält den Status pro Agent-Session, wendet die Regeln aus Abschnitt 3 an, löst Notifications aus |
| `Store` | atomares Lesen und Schreiben von `state.json` |

### Agent-Typ-Schnittstelle (Skizze)

Die Schnittstelle, über die Codex später andockt:

```ts
/** Everything the Argus needs to know about one agent CLI. */
interface AgentTypeAdapter {
  /** Stable identifier, e.g. "claude-code" or "codex". */
  readonly id: string;
  /** Builds the shell command that starts a new agent session. */
  buildStartCommand(context: AgentLaunchContext): string;
  /** Builds the shell command that resumes an existing conversation. */
  buildResumeCommand(context: AgentLaunchContext, conversationId: string): string;
  /** Builds the hook settings file content for the given hook server port; validated with zod before writing. */
  buildHookSettings(port: number): HookSettingsFile;
  /** Translates a raw hook payload into a status event, or null if irrelevant. */
  interpretHookEvent(payload: unknown): AgentStatusEvent | null;
  /** Translates a terminal signal (key press, title change) into a status event, e.g. an interrupt. */
  interpretTerminalSignal(signal: TerminalSignal): AgentStatusEvent | null;
}

/** Raw signal from the PTY, forwarded by the TerminalService. */
type TerminalSignal =
  | { kind: 'input'; data: string; at: number }
  | { kind: 'title'; title: string; at: number };
```

## 5. Abläufe

### 5.1 Projekt hinzufügen

1. Repo-Ordner auswählen → prüfen, ob es ein Git-Repo ist
2. Haupt-Branch ermitteln (`origin/HEAD`), Branch-Präfix (ein Segment ohne `/`, Default `agent`; Branches heißen dann `agent/<task-name>`) und Default-Agent-Typ festlegen
3. Optional ein lokales **Setup-Skript** (PowerShell) hinterlegen, z. B. `.env` kopieren oder `dotnet restore`

### 5.2 Task anlegen

**Eingaben:** Projekt, Task-Name, Basis-Branch (Default: Haupt-Branch), optional Start-Prompt und Agent-Typ.

1. Name bereinigen und eindeutig machen → `<WorktreeRoot>\<Projekt>\<task-name>`
   - Der WorktreeRoot ist global einstellbar, z. B. `D:\Worktrees`
   - Namen gelöschter Tasks werden **nicht wiederverwendet**: Claude speichert Konversationen pro Pfad
2. `git fetch` für den Basis-Branch, dann:
   `git worktree add --no-track -b <präfix>/<task-name> <pfad> <basis>`
3. `git config push.autoSetupRemote true` im Worktree, Basis-Branch im Task speichern
4. Ist ein Setup-Skript vorhanden: Es läuft **sichtbar** im ersten Terminal, mit `ARGUS_ROOT_PATH` (Haupt-Repo) und `ARGUS_WORKTREE_PATH` (Worktree) in der Umgebung. Die Agent-Session startet erst, wenn das Setup beendet ist.
   - Endet das Setup mit Fehler (Exit-Code ≠ 0), kommt die Rückfrage **„Setup fehlgeschlagen. Agent-Session trotzdem starten?“**. Die Ausgabe des Setups bleibt im Terminal sichtbar.
5. Agent-Session starten (siehe 5.3)

### 5.3 Agent-Session starten bzw. fortsetzen

**Vorab, bei jedem App-Start:** Argus schreibt die Hook-Settings-Datei `%APPDATA%\Argus\hooks\claude-code.json` mit dem aktuellen Port des Hook-Servers. Es ist eine Datei für alle Agent-Sessions. Token und Agent-Session-ID kommen über Header aus Umgebungsvariablen, der Port steht als Zahl in der URL, weil `$VAR` in der `url` nicht aufgelöst wird.

1. Eine Agent-Session-ID erzeugen.
2. PTY starten: `pwsh -NoExit` (Fallback `powershell.exe`), `cwd` = Worktree. Umgebungsvariablen setzen:
   - `ARGUS_TOKEN`
   - `ARGUS_SESSION_ID`
   - Geerbte `CLAUDE*`-Variablen **entfernen**. Sonst erbt Claude die Variablen einer umgebenden Claude-Session, speichert kein Transcript, und `--resume` funktioniert nicht.
3. Befehl: `claude --settings <hook-datei> ['<start-prompt>']`
   - Fortsetzen: `claude --settings <hook-datei> --resume <konversations-id>`
   - Den Befehl per `-EncodedCommand` übergeben, den Start-Prompt darin als String in einfachen Anführungszeichen (`'` verdoppeln). Im Spike kamen `"`, `'`, `$`, Umlaute und Backticks unverfälscht an.
4. `SessionStart` liefert die `session_id` von Claude. Sie wird als **Konversations-ID** gespeichert und für `--resume` gebraucht. Jedes weitere `SessionStart` (z. B. nach `/clear`) überschreibt sie.

Hook-Settings (Skizze, Port `51234` als Beispiel):

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{
      "type": "http",
      "url": "http://127.0.0.1:51234/hooks/claude-code",
      "timeout": 2,
      "headers": {
        "X-Argus-Token": "$ARGUS_TOKEN",
        "X-Argus-Session": "$ARGUS_SESSION_ID"
      },
      "allowedEnvVars": ["ARGUS_TOKEN", "ARGUS_SESSION_ID"]
    }]}],
    "SessionStart": [{ "hooks": [{
      "type": "command",
      "shell": "powershell",
      "timeout": 3,
      "command": "curl.exe -s -m 2 -H 'Content-Type: application/json' -H \"X-Argus-Token: $env:ARGUS_TOKEN\" -H \"X-Argus-Session: $env:ARGUS_SESSION_ID\" --data-binary '@-' http://127.0.0.1:51234/hooks/claude-code"
    }]}]
  }
}
```

Die HTTP-Konfiguration gilt für: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd`. `SessionStart` unterstützt keine HTTP-Hooks und bekommt deshalb den Command-Hook ([ADR 0003](adr/0003-hooks-per-settings-flag-und-http.md)).

> [!WARNING]
> **Die Datei muss strikt gültig sein.** Ein ungültiger `PreToolUse`- oder `PermissionRequest`-Hook lässt Claude die gesamte Datei verwerfen, und es kommt kein Event an. Argus erzeugt sie aus Code und validiert sie mit zod.

### 5.4 Arbeiten am Task

- Ein Klick auf einen Task öffnet die Task-Ansicht. Tab 1 ist die Agent-Session, die weiteren Tabs sind Terminals (`+` für ein neues).
- Ein Klick auf einen Task mit Status **Wartet** springt direkt in den Tab der Agent-Session.
- Freigaben und Rückfragen beantworte ich **im Terminal**, nicht über die Oberfläche.
- Commit, Push und PR erledigt die Agent-Session per Prompt (`git`, `gh` bzw. `az`) oder ich selbst im Git-Tool.
- Review findet außerhalb statt (Git-Tool bzw. PR). Argus bietet „Im Editor öffnen“ und „Im Explorer öffnen“.

### 5.5 Task entfernen

1. Prüfen, ob die Agent-Session **arbeitet** → Warnung
2. Alle PTYs des Tasks beenden und das Ende abwarten (Windows hält sonst Dateien fest)
3. Prüfen: uncommittete Änderungen? ungepushte Commits? → in der Bestätigung anzeigen
4. `git worktree remove <pfad>`
5. `git branch -d <branch>`
   - Schlägt das fehl (z. B. nach einem Squash-Merge des PRs): Rückfrage **„Branch ist nicht gemerged. Trotzdem löschen?“**. Hinweis „ist vollständig gepusht“ bzw. **ungepushte Commits rot markiert**. Erst nach Bestätigung `git branch -D`.
6. Task aus `state.json` entfernen, Task-Namen als „verbraucht“ merken

### 5.6 App schließen und starten

- **Schließen:** Wenn Agent-Sessions **arbeiten**, gibt es eine Warnung. Danach werden alle PTYs beendet.
- **Starten:** Projekte und Tasks werden aus `state.json` geladen. Alle Agent-Sessions stehen auf **Beendet** und lassen sich per Button **Fortsetzen** wiederaufnehmen. Worktrees, die es nicht mehr gibt, werden markiert.

## 6. Oberfläche

```
┌─────────────────────────┬──────────────────────────────────────────────────┐
│ Argus              [+]  │ login-refactoring          agent/login-refactoring│
│                         │ D:\Worktrees\webshop\login-refactoring            │
│ ▾ WEBSHOP               │ [Im Editor] [Explorer] [Fortsetzen] [Entfernen]   │
│   ● login-refactoring   │──────────────────────────────────────────────────│
│     Wartet · 2 Sub · 5Δ │ [● Claude Code] [Terminal 1] [+]                  │
│   ● pdf-export          │                                                   │
│     Arbeitet · 3Δ       │  > claude                                         │
│ ▾ HomeServer            │  Claude möchte `dotnet test` ausführen.           │
│   ● api-caching         │  1. Ja  2. Ja, immer  3. Nein                     │
│     Bereit · 12Δ        │                                                   │
│   ○ readme-update       │                                                   │
│     Beendet             │                                                   │
└─────────────────────────┴──────────────────────────────────────────────────┘
  ● Farbe = Status · „2 Sub“ = aktive Subagents · „5Δ“ = geänderte Dateien
```

**Notifications:** Ein Windows-Toast bei **Wartet**, **Bereit** und **Fehler**, aber nur wenn das Fenster nicht im Fokus ist. Ein Klick auf den Toast öffnet den Task.

## 7. MVP-Umfang

**Drin**
- [ ] Projekte hinzufügen und entfernen, Einstellungen pro Projekt (Präfix, Default-Agent-Typ, Setup-Skript)
- [ ] Task anlegen (Worktree + Branch), Setup-Skript ausführen
- [ ] Agent-Session mit Claude Code starten, optional mit Start-Prompt
- [ ] Status per Hooks, Statusregeln inklusive Subagent-Zähler und Abbruch-Erkennung über den Terminal-Titel
- [ ] Sidebar mit Status, Subagent-Zähler und Anzahl geänderter Dateien
- [ ] Task-Ansicht mit Tabs (Agent-Session + Terminals)
- [ ] Toast-Notifications
- [ ] Task entfernen mit sicherer Branch-Löschung
- [ ] Persistenz und „Fortsetzen“ per `--resume`
- [ ] Buttons „Im Editor öffnen“ und „Im Explorer öffnen“

**Bewusst nicht drin**
- Diff- bzw. Review-Ansicht, Zeilen-Kommentare
- Git-Aktionen in der Oberfläche (Commit, Push, PR, Merge)
- Freigaben über die Oberfläche beantworten
- Split-Panes, frei anordenbare Layouts
- Hintergrunddienst für Terminals
- Remote, SSH, WSL, Mobile, macOS, Linux
- automatisches Cleanup, Sparse Checkout, vorbereitete Worktrees

## 8. Später (Backlog)

1. **Codex** als zweiter Agent-Typ (Hooks bzw. Status-Erkennung von Codex klären)
2. **Diff-Ansicht** pro Task (Monaco DiffEditor)
3. **Setup-Datei im Repo** (`.argus.yaml`) mit Trust per Hash, für Kollegen
4. **Installer und Auto-Update** (`electron-builder`, `electron-updater`) zur Verteilung an Kollegen
5. Tray-Icon mit Zähler „wartet auf dich“
6. Button „Pushen und PR erstellen“ (GitHub bzw. Azure DevOps)
7. Freigaben direkt aus der Oberfläche beantworten (`PermissionRequest` offen halten)
8. Feedback-Schleife: Zeilen-Kommentare als Prompt an die Agent-Session
9. Aktivitätsmeldungen per OSC 7501 (Claudes Anfrage `7501;?` beantworten) als präzisere Abbruch-Erkennung, siehe [ADR 0005](adr/0005-abbruch-ueber-tastendruck-und-terminal-titel.md)

## 9. Im Prototyp zu prüfen

Der Spike zu Issue #1 (Node + node-pty + Hook-Server, ohne Electron; Code auf Branch `spike/hooks`) hat die Annahmen geprüft. Die Details stehen in [ADR 0003](adr/0003-hooks-per-settings-flag-und-http.md#ergebnisse-des-spikes-issue-1).

- [x] Laufen Hooks aus `--settings` **zusätzlich** zu den Hooks in `~/.claude/settings.json`? → **Ja.**
- [x] Verhalten bei nicht erreichbarer Hook-URL → Ein geschlossener Port kostet nichts. Ein Server, der nicht antwortet, kostet pro blockierendem Event das volle Timeout, deshalb 2–3 s.
- [x] Werden `$VAR` in `url` und `headers` aufgelöst? → **Nur in `headers`.** Der Port steht deshalb als Zahl in der URL.
- [x] Ist bei Hook-Events von Subagents `agent_id` gesetzt? → **Ja.** Interne Agents senden aber `SubagentStop` ohne `SubagentStart` (Regel 1).
- [x] Welches Event kommt beim Abbruch per Escape? → **Keins**, auch bei Strg+C nicht. Erkennung über den Terminal-Titel ([ADR 0005](adr/0005-abbruch-ueber-tastendruck-und-terminal-titel.md)).
- [x] Kommt `SessionEnd` zuverlässig, auch bei `/exit` und Strg+C? → **Im Leerlauf ja**, mit `reason: prompt_input_exit`. Ein `/exit` während der Arbeit wird nicht ausgeführt. Endet die PTY, kommt `reason: other`.
- [ ] node-pty mit ConPTY in Electron unter Windows: Rendering, Resize, Umlaute → nicht Teil des Spikes, das prüft das Grundgerüst
- [x] Start-Prompt mit Sonderzeichen sicher übergeben → `-EncodedCommand` mit String in einfachen Anführungszeichen funktioniert

Zusätzlich gefunden: `SessionStart` unterstützt keine HTTP-Hooks (deshalb ein Command-Hook), `/clear` vergibt eine neue `session_id`, und ein ungültiger Hook verwirft die ganze `--settings`-Datei. Die Orca-Variante mit globalem Hook-Skript wird nicht gebraucht.

## 10. Umsetzung

- **Eigenes Git-Repository** (Name: **Argus**, Repo `argus`)
- Repo: https://github.com/viper1979/argus
- **Glossar und ADRs leben ab jetzt im Repo** (`GLOSSARY.md`, `docs/adr/`). Sie sind die maßgebliche Quelle.
- Es gelten die allgemeinen Coding-Guidelines: Code auf Englisch, Doc-Comments, Unit-Tests (AAA-Muster) für Geschäftslogik. Zuerst testen: Statusregeln (`StatusTracker`, `interpretHookEvent`, `interpretTerminalSignal`), Pfad- und Namensbildung, Branch-Lösch-Entscheidung.
- Reihenfolge: **Spike (Abschnitt 9, erledigt) → Grundgerüst Electron → Projekte und Tasks → Terminals → Hooks und Status → Entfernen → Persistenz und Fortsetzen**
