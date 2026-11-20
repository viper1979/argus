# Argus

**A**gent **R**un **G**overnance & **U**nified **S**upervision

Windows-Desktop-App, um mehrere Coding-Agents (zunächst Claude Code, später Codex) parallel über mehrere Repositories hinweg zu starten und zu beobachten. Jede Aufgabe läuft isoliert in einem eigenen Git-Worktree; Argus zeigt auf einen Blick, welche Agent-Session arbeitet, auf Eingaben wartet oder bereit ist.

> In der griechischen Mythologie ist *Argus Panoptes* der hundertäugige Wächter, der nie alle Augen gleichzeitig schließt.

## Status

Frühe Entwicklung: Das Grundgerüst (Electron-Fenster, typisierte IPC) steht, die Features folgen.

## Entwicklung

Voraussetzungen: Windows, Node 24, pnpm.

```powershell
pnpm install
pnpm dev
```

## Dokumentation

- [Glossar](GLOSSARY.md) – Fachbegriffe (Projekt, Task, Agent-Session, Status …)
- [Architektur-Entscheidungen](docs/adr/) – ADRs

## Geplanter Tech-Stack

Electron · TypeScript · React · Tailwind CSS · shadcn/ui · Zustand · xterm.js · node-pty
