---
status: accepted
date: 2026-11-19
---

# Status-Hooks per `--settings` und HTTP-Hooks statt globaler Installation

Argus startet Claude Code mit `claude --settings <generierte-datei.json>`. Darin stehen **HTTP-Hooks** (`"type": "http"`), die direkt an `http://127.0.0.1:<port>/hooks/claude` posten. Die Zuordnung zur Agent-Session läuft über Header aus Umgebungsvariablen, die Argus beim Start des PTYs setzt (`allowedEnvVars`). Die globale `~/.claude/settings.json` wird **nie verändert**. Das ist eine bewusste Abweichung von Orca, das ein Skript global installiert und per `curl` postet. Unser Weg braucht keine Install- und Uninstall-Logik, kein Hook-Skript und keine Guards für `claude` außerhalb des Tools.

## Consequences

- Benötigte Events: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd`.
- **Noch zu verifizieren (Prototyp):**
  - Werden Hooks aus `--settings` *zusätzlich* zu den Hooks des Users ausgeführt?
  - Wie verhält sich Claude, wenn die Hook-URL nicht erreichbar ist (Timeout klein halten)?
- **Fallback:** Gibt es damit Probleme, wechseln wir zur Orca-Variante: ein globales Hook-Skript, ein Guard auf eine Umgebungsvariable und `curl.exe`.
