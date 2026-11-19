# Argus

Desktop-Tool, um mehrere Coding-Agents parallel in isolierten Aufgaben über mehrere Repositories hinweg zu starten, zu beobachten und zu steuern.

## Organisation

**Projekt**:
Ein Git-Repository, das in Argus registriert ist. Projekte gruppieren Tasks in der Übersicht, haben aber selbst keinen Arbeitszustand.
_Avoid_: Repo (im Fachtext), Workspace, Solution

**Task**:
Eine abgegrenzte Aufgabe innerhalb eines Projekts mit genau einem eigenen Worktree und Branch. Ein Task ist die Einheit, die gestartet, beobachtet und am Ende gemerged oder verworfen wird.
_Avoid_: Workspace, Job, Ticket, Worktree (als Synonym)

**Terminal**:
Eine PowerShell innerhalb eines Tasks, die keine Agent-Session ist, z. B. für `dotnet watch` oder Git-Befehle.
_Avoid_: Shell, Konsole, Tab

## Agents

**Agent-Typ**:
Ein unterstütztes Agent-CLI-Programm, z. B. Claude Code oder Codex.
_Avoid_: Agent, Provider, Modell

**Agent-Session**:
Eine von dir gestartete Konversation eines Agent-Typs innerhalb eines Tasks. Sie überdauert ihren Prozess: Nach dem Beenden kann sie fortgesetzt werden und bleibt dieselbe Agent-Session. Pro Task läuft höchstens eine gleichzeitig.
_Avoid_: Agent, Run, Prozess, Chat

**Subagent**:
Ein Agent, den eine Agent-Session selbst startet. Argus startet oder steuert ihn nicht, er zählt ihn nur.
_Avoid_: Worker, Child-Agent

## Status einer Agent-Session

**Arbeitet**:
Die Agent-Session ist mitten in einem Turn und braucht dich gerade nicht.
_Avoid_: Running, Busy, Aktiv

**Wartet**:
Die Agent-Session ist blockiert, bis du eine Freigabe erteilst oder eine Rückfrage beantwortest.
_Avoid_: Blocked, Pending, Pausiert

**Bereit**:
Die Agent-Session hat ihren Turn abgeschlossen und wartet auf den nächsten Prompt; das Ergebnis kann geprüft werden.
_Avoid_: Fertig, Done, Idle

**Fehler**:
Der letzte Turn wurde durch einen Fehler abgebrochen, nicht durch dich.
_Avoid_: Failed, Crashed

**Beendet**:
Der Prozess der Agent-Session läuft nicht mehr; die Konversation ist fortsetzbar.
_Avoid_: Gestoppt, Geschlossen, Pausiert
