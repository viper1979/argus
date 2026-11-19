---
status: accepted
date: 2026-11-19
---

# Kein Hintergrunddienst für Terminals

Alle PTYs leben im Electron-Hauptprozess und **enden beim Schließen der App**. Beim nächsten Start werden Projekte und Tasks wiederhergestellt. Agent-Sessions erscheinen als **Beendet** und lassen sich per `--resume` fortsetzen. Orca betreibt dagegen einen eigenen Daemon, damit Terminals einen Neustart überleben. Wir verzichten bewusst darauf, weil `--resume` den Gesprächskontext ohnehin erhält und ein Daemon viel Komplexität bringt (Reconnect, veraltete Ports, Persistenz des Scrollbacks). Vor dem Schließen warnt die App, wenn noch Agent-Sessions **arbeiten**.
