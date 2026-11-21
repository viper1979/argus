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

## Nachtrag: Smoke-Test zu #8 (2026-11-21)

- **Umsetzung:** Der `AgentTypeAdapter` erzeugt pro Agent-Session einen Signal-Interpreter mit injizierter Uhr (Konzept 4). Ein Tastendruck zählt nur, wenn die Eingabe *genau* `\x1b`, `\x1b[27u` oder `\x03` ist. Pfeiltasten beginnen ebenfalls mit ESC und dürfen nicht zählen. Spinner-Titel lassen den gemerkten Tastendruck stehen, weil ein Spinner-Tick vor dem Leerlauf-Titel kommen kann. Ein zweiter Tastendruck startet das Fenster neu.
- **Bestätigt in Argus:** Escape während **Arbeitet** führte nach 78 ms zu **Bereit**. ConPTY reicht den Titel (OSC 0) also bis zu Argus durch. Der `TerminalService` wertet neben OSC 0 auch OSC 2 aus, weil beide den Fenstertitel setzen.
- **Grenze: Abbruch aus „Wartet“.** Escape in einer Freigabe-Abfrage oder bei `AskUserQuestion` beendet den Turn, ebenfalls ohne Hook-Event. Claude setzt `✳` aber schon, sobald die Abfrage erscheint (gemessen 1,2–1,5 s vor dem Escape), danach kommt kein neuer Titel. Das Signal „Tastendruck, dann `✳`“ entsteht dort also nie, und Argus erkennt den Abbruch nicht. **Wartet** bleibt bis zum nächsten Prompt stehen.
  - Verworfen: Escape bei **Wartet** allein als Abbruch werten. Ein Escape, das die Abfrage nicht beendet (z. B. aus dem Eingabefeld „Tab to amend“ heraus), würde fälschlich **Bereit** zeigen.
  - Die Anfrage `OSC 7501;?` aus dem Backlog könnte diese Lücke schließen.
