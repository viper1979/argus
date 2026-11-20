---
status: accepted
date: 2026-11-20
---

# `push.autoSetupRemote` per Umgebung statt Repo-Config

Task-Branches entstehen ohne Upstream (`git worktree add --no-track`). Damit der erste `git push` im Task trotzdem ohne `-u` funktioniert, braucht Git `push.autoSetupRemote = true`. Argus schreibt diesen Wert **nicht** in die Config des Repos. Stattdessen bekommt jedes Terminal eines Tasks den Wert über Git-Umgebungsvariablen:

```
GIT_CONFIG_COUNT=1
GIT_CONFIG_KEY_0=push.autoSetupRemote
GIT_CONFIG_VALUE_0=true
```

Er gilt damit für alles, was Argus im Task startet, also für die PowerShell, die Agent-Session und deren `git push`. Ein schlichtes `git config` im Worktree schreibt in die gemeinsame `.git/config`. Damit würde Argus nebenbei auch den Haupt-Checkout und fremde Worktrees umkonfigurieren. `git config --worktree` wirkt zwar nur im Worktree, setzt aber `extensions.worktreeConfig` voraus und hebt das Repo-Format dauerhaft auf `repositoryformatversion = 1`. Tools mit eigener Git-Implementierung können das Repo dann eventuell nicht mehr öffnen. Wie bei den Hooks ([ADR 0003](0003-hooks-per-settings-flag-und-http.md)) konfiguriert Argus deshalb nur das, was es selbst startet.

## Consequences

- Ein `git push` ohne Upstream, der **außerhalb** von Argus im Worktree läuft (IDE, eigenes Terminal), braucht weiterhin `-u`. Das ist gewollt.
- Setzt der User selbst schon `GIT_CONFIG_COUNT`, hängt Argus seinen Eintrag hinten an (Index = bisheriger Zähler) und überschreibt nichts.
- `GIT_CONFIG_COUNT` gibt es seit Git 2.31, `push.autoSetupRemote` seit 2.37. Es entsteht also keine zusätzliche Anforderung.
- Umgesetzt wird das mit den Terminals (#5), nicht beim Anlegen des Tasks (#4).
