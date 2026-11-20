---
status: accepted
date: 2026-11-20
---

# Abbruch einer Agent-Session über Tastendruck und Terminal-Titel erkennen

Bricht der User einen Turn per Escape oder Strg+C ab, sendet Claude Code **kein** Hook-Event. Im Spike zu ADR 0003 kam weder `Stop` noch `PostToolUseFailure`. Ohne Gegenmaßnahme bliebe die Agent-Session auf **Arbeitet** stehen.

Argus erkennt den Abbruch deshalb aus zwei Signalen des Terminals, so wie Orca (`claude-terminal-interrupt.ts`):

1. **Tastendruck:** Der User schickt Escape (`\x1b` oder Kitty-CSI-u `\x1b[27u`) oder Strg+C (`\x03`) in die PTY, während die Agent-Session auf **Arbeitet** steht.
2. **Terminal-Titel:** Claude setzt per OSC 0 eine Glyphe vor den Titel. Solange Claude arbeitet, wechselt sie im Sekundentakt zwischen `◐` und `◑`, auch während ein Tool läuft. Im Leerlauf steht `✳`.

Erscheint innerhalb eines kurzen Fensters (5 s) nach dem Tastendruck der Leerlauf-Titel `✳`, setzt Argus die Agent-Session auf **Bereit**. Läuft der Spinner weiter, war der Tastendruck kein Abbruch, er hat z. B. nur eine Ansicht geschlossen. Dann ändert sich nichts.

## Considered Options

- **Ausgabe-Inaktivität:** Status nach X Sekunden ohne PTY-Ausgabe zurücksetzen. Verworfen: Lange Tool-Läufe ohne Ausgabe würden fälschlich als Abbruch gelten.
- **Nur die Titel-Glyphe:** Verworfen, weil der Titel bei jedem Turn-Ende auf `✳` wechselt, das Ende des Turns aber schon `Stop` meldet. Erst der Tastendruck macht aus dem Wechsel ein eindeutiges Abbruchsignal.
- **Anfrage `OSC 7501;?` beantworten:** Claude meldet dann „working“ und „idle“ explizit. Das ist am präzisesten, aber undokumentiert. Bleibt im Backlog.
- **Status bewusst stehen lassen:** Verworfen, weil abgebrochene Agent-Sessions sonst dauerhaft als **Arbeitet** erscheinen.

## Consequences

- Gemessen: Der Leerlauf-Titel kam 24–77 ms nach dem Tastendruck, in der Denkphase genauso wie während eines laufenden Tools. Das sind Einzelmessungen pro Fall.
- Die Glyphen sind Claude-spezifisch. Erkennung und Fenster leben deshalb im `AgentTypeAdapter` für Claude Code. Der `TerminalService` liefert nur Terminal-Signale (Eingabe, Titel).
- Ändert Claude Code die Titel-Glyphen, fällt die Erkennung still aus, und der Status bleibt bis zum nächsten Hook-Event auf **Arbeitet**. Die Glyphen gehören deshalb in eine Konstante mit Test.
