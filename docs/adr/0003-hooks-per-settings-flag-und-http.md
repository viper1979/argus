---
status: accepted
date: 2026-11-19
---

# Status-Hooks per `--settings` und HTTP-Hooks statt globaler Installation

Argus startet Claude Code mit `claude --settings <generierte-datei.json>`. Darin stehen **HTTP-Hooks** (`"type": "http"`), die direkt an `http://127.0.0.1:<port>/hooks/claude-code` posten. Die Zuordnung zur Agent-Session läuft über Header aus Umgebungsvariablen, die Argus beim Start des PTYs setzt (`allowedEnvVars`). Die globale `~/.claude/settings.json` wird **nie verändert**. Das ist eine bewusste Abweichung von Orca, das ein Skript global installiert und per `curl` postet. Unser Weg braucht keine Install- und Uninstall-Logik, kein Hook-Skript und keine Guards für `claude` außerhalb des Tools.

**Einzige Ausnahme:** `SessionStart` unterstützt keine HTTP-Hooks. Dafür steht in derselben generierten Datei ein **Command-Hook** mit `curl.exe`, der den Payload von stdin unverändert an denselben Endpunkt weiterreicht. Auch er ist nur in Sessions aktiv, die Argus startet, und braucht weder Skriptdatei noch Guard.

## Consequences

- Benötigte Events: `SessionStart` (Command-Hook), `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd`.
- **Der Port steht als Zahl in der `url`.** `$VAR` wird dort nicht aufgelöst. Argus schreibt die Datei deshalb bei jedem App-Start mit dem aktuellen Port neu.
- **Die generierte Datei muss strikt gültig sein.** Ein ungültiger `PreToolUse`- oder `PermissionRequest`-Hook lässt Claude die **gesamte** `--settings`-Quelle verwerfen, und es kommt kein einziges Event an. Argus erzeugt die Datei deshalb aus Code, validiert sie mit zod und testet sie.
- **Timeout klein halten (2–3 s).** Ein Hook-Server, der nicht antwortet, verzögert `UserPromptSubmit` und `SessionEnd` jeweils um das volle Timeout. Ein geschlossener Port kostet dagegen nichts.
- **`CLAUDE*`-Umgebungsvariablen nicht vererben.** Startet Argus aus einer Claude-Session heraus (Entwicklung), erbt der neue Claude deren Variablen und speichert kein Transcript. Der Spike zeigte dazu die Meldung „Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker“. Dann funktioniert `--resume` nicht. Die Hooks selbst kommen trotzdem an.
- Abbruch per Escape oder Strg+C erzeugt **kein** Hook-Event. Wie Argus ihn trotzdem erkennt, regelt [ADR 0005](0005-abbruch-ueber-tastendruck-und-terminal-titel.md).

## Ergebnisse des Spikes (Issue #1)

Geprüft mit Claude Code 2.1.329 unter Windows 10, `pwsh` 7 in node-pty/ConPTY, Model Haiku. Der Spike-Code liegt auf dem Branch `spike/hooks`.

| Frage | Ergebnis |
|---|---|
| Laufen Hooks aus `--settings` zusätzlich zu `~/.claude/settings.json`? | **Ja.** `UserPromptSubmit`, `Stop` und `SessionEnd` kamen bei beiden Hooks an. Der User-Hook hatte dabei eine eigene URL. Laut Doku führt Claude *identische* Handler nur einmal aus. Das hat der Spike nicht geprüft. |
| Nicht erreichbare Hook-URL | **Port geschlossen:** keine messbare Verzögerung (3,4 s statt 3,2 s bis zur Antwort). **Server antwortet nicht** (Timeout 3 s): Die Antwort kommt rund 3 s später, und `/exit` dauert ebenfalls rund 3 s länger. |
| `$VAR` in `url` und `headers` | **Header:** `$VAR` und `${VAR}` werden aufgelöst. Eine Variable, die nicht in `allowedEnvVars` steht, wird zu einem leeren String. **URL:** Es wird nichts aufgelöst. `$VAR` als Port macht die URL ungültig, `$VAR` im Query-String kommt wörtlich an. |
| `agent_id` bei Subagents | **Ja.** Events eines Subagents tragen `agent_id` und `agent_type`, Events des Haupt-Agents nie. |
| Ablauf mit Subagent | Der Subagent lief asynchron, auch mit `run_in_background false`. Die Reihenfolge war: `Stop` des Haupt-Agents, dann ein synthetisches `UserPromptSubmit` mit `<agent-message …>` als Hand-back, wenige Millisekunden danach `SubagentStop` des Subagents, dann ein zweites `Stop`. |
| Claude-interne Hilfsagents | In Läufen mit Tool- oder Subagent-Aufrufen kam nach dem `Stop` ein `SubagentStop` mit leerem `agent_type` und **ohne** vorheriges `SubagentStart`. In Läufen ohne Tools kam es nicht. |
| Escape oder Strg+C während der Arbeit | **Kein Event**, weder in der Denkphase noch während eines laufenden Tools (dort auch kein `PostToolUseFailure`). Wird vor der ersten Ausgabe abgebrochen, legt Claude den Prompt zurück ins Eingabefeld. Das zeigt das Transcript: Der Folge-Prompt wurde an den abgebrochenen angehängt. |
| `/exit` und zweimal Strg+C im Leerlauf | `SessionEnd` mit `reason: prompt_input_exit`, nach rund 0,6 s (Strg+C) bzw. unter 2 s (`/exit`). Die PowerShell läuft weiter. |
| `/exit`, während Claude arbeitet | Wird **nicht** ausgeführt, es kommt kein `SessionEnd`. Erst wenn die PTY beendet wird, kommt `SessionEnd` mit `reason: other`. |
| `/clear` | `SessionEnd` mit `reason: clear`, danach `SessionStart` mit `source: clear` und einer **neuen** `session_id`. |
| `SessionStart` | HTTP-Hooks werden ohne Warnung ignoriert, laut Doku sind nur `command` und `mcp_tool` erlaubt. Ein `curl.exe`-Command-Hook funktioniert bei `startup`, `clear` und `resume`. Getestet sind `shell: powershell` und die Standard-Shell, gewählt wird `shell: powershell`, weil sie nicht von Git Bash abhängt. |
| Start-Prompt mit Sonderzeichen | Kommt unverfälscht an, wenn er über `-EncodedCommand` als PowerShell-String in einfachen Anführungszeichen übergeben wird (`'` verdoppelt). Getestet mit `"`, `'`, `$HOME`, `${x}`, Umlauten, `€`, Backticks, `%`, `&`, `\|`, `<`, `>`. |

Alle Zeiten sind Einzelmessungen (n=1). Sie zeigen Größenordnungen, keine Grenzwerte.

Nicht Teil des Spikes: node-pty in Electron (Rendering, Resize). Das prüft das Grundgerüst.
