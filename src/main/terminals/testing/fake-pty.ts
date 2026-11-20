import type { TerminalSize } from '@shared/domain/terminal';
import type { PtyProcess, PtySpawnOptions, SpawnPty } from '../pty';
import { ShellExecutableNotFoundError } from '../shell-executable-not-found-error';

/** In-memory pseudo terminal for service tests; records input and lets the test emit output. */
export class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: TerminalSize[] = [];
  killCount = 0;
  /** Whether {@link kill} ends the process right away, like a shell that exits promptly. */
  shouldExitOnKill = true;
  private readonly dataListeners: ((data: string) => void)[] = [];
  private readonly exitListeners: ((exitCode: number) => void)[] = [];

  /**
   * @param executable Program the process was started with.
   * @param args Its command-line arguments.
   * @param options Working directory, environment and size it was started with.
   */
  constructor(
    readonly executable: string,
    readonly args: readonly string[],
    readonly options: PtySpawnOptions,
  ) {}

  /** @inheritdoc */
  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  /** @inheritdoc */
  onExit(listener: (exitCode: number) => void): void {
    this.exitListeners.push(listener);
  }

  /** @inheritdoc */
  write(data: string): void {
    this.writes.push(data);
  }

  /** @inheritdoc */
  resize(size: TerminalSize): void {
    this.resizes.push(size);
  }

  /** @inheritdoc */
  kill(): void {
    this.killCount += 1;
    if (this.shouldExitOnKill) {
      this.emitExit(1);
    }
  }

  /**
   * Simulates output of the process.
   * @param data The output chunk.
   */
  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  /**
   * Simulates the end of the process.
   * @param exitCode Exit code reported to the listeners.
   */
  emitExit(exitCode: number): void {
    for (const listener of this.exitListeners) {
      listener(exitCode);
    }
  }
}

/** Fake {@link SpawnPty}: hands out {@link FakePtyProcess}es and can pretend programs are missing. */
export class FakePtySpawner {
  readonly processes: FakePtyProcess[] = [];
  /** Programs that "do not exist"; spawning them throws like the node-pty adapter does. */
  readonly missingExecutables = new Set<string>();

  /** The spawn function to inject into the service. */
  readonly spawn: SpawnPty = (executable, args, options) => {
    if (this.missingExecutables.has(executable)) {
      throw new ShellExecutableNotFoundError(executable, new Error('Simulated missing executable'));
    }
    const process = new FakePtyProcess(executable, args, options);
    this.processes.push(process);
    return process;
  };

  /**
   * Returns the n-th started process and fails the test if there is none.
   * @param index Position in start order.
   * @returns The process.
   */
  processAt(index: number): FakePtyProcess {
    const process = this.processes[index];
    if (!process) {
      throw new Error(`No pty process was started at index ${index}`);
    }
    return process;
  }
}
