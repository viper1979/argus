# Spike: Hook-Mechanismus (Issue #1)

Wegwerf-Prototyp zur Prüfung von [ADR 0003](../../docs/adr/0003-hooks-per-settings-flag-und-http.md). Liegt nur auf dem Branch `spike/hooks`, wird **nicht** gemerged.

## Aufbau

| Datei | Zweck |
|---|---|
| `src/hook-server.mjs` | HTTP-Server auf `127.0.0.1`, schreibt jeden Hook-POST als JSONL (Modus `respond` oder `hang`) |
| `src/settings.mjs` | Erzeugt die `--settings`-Datei mit HTTP-Hooks, `$VAR`/`${VAR}`-Headern und `allowedEnvVars` |
| `src/pty-session.mjs` | Startet `pwsh -NoExit -EncodedCommand …` in node-pty/ConPTY und entfernt geerbte `CLAUDE*`-Variablen |
| `src/user-settings.mjs` | Ergänzt für das Szenario `user-hook` kurzzeitig einen Hook in `~/.claude/settings.json` und stellt die Datei danach byte-genau wieder her |
| `src/scenarios.mjs` | Automatisierte Szenarien (Model: `haiku`) |

## Ausführen

```powershell
npm install
npm install-scripts approve node-pty   # Prebuild von node-pty freigeben
node run.mjs all                        # oder einzelne Szenarien, z. B. node run.mjs basic escape-tool
```

Szenarien: `basic`, `no-prompt`, `subagent-foreground`, `subagent-background`, `escape`, `escape-tool`, `ctrlc`, `user-hook`, `latency`.
Die Ausgabe landet in `.tmp/other/spike-hooks/<Zeitstempel>/<Szenario>/`: `events.jsonl`, `pty-output.log`, `settings.json`, `summary.json`.
Mit `SPIKE_KEEP_CLAUDE_ENV=1` bleiben geerbte `CLAUDE*`-Variablen erhalten (Gegenprobe).

Die `AttachConsole failed`-Stacktraces beim Beenden kommen von node-pty (`kill()` unter ConPTY) und sind harmlos.

## Ergebnisse

Stehen in ADR 0003.
