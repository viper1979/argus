---
status: accepted
date: 2026-11-19
---

# Zunächst nur Windows, Agents laufen in PowerShell

Argus unterstützt zunächst **ausschließlich Windows**. Jedes Terminal ist eine **PowerShell** in einem echten PTY (ConPTY). Agent-CLIs wie `claude` werden *innerhalb* dieser PowerShell gestartet, nicht direkt als PTY-Prozess. Das entspricht der gewohnten Arbeitsweise. Nach dem Beenden des Agents bleibt die Shell nutzbar. macOS, Linux und WSL sind bewusst außen vor. Pfade, Hook-Skripte und Shell-Aufrufe dürfen Windows-spezifisch sein, bis sich diese Entscheidung ändert.
