import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import type { AgentTypeAdapter } from '../agents/agent-type-adapter';
import { createFakeAgentTypeAdapter } from '../agents/testing/fake-agent-type-adapter';
import type { Logger } from '../logging/logger';
import type { HookServer, HookServerOptions } from './hook-server';
import { startAgentHooks, type WriteHookSettingsFile } from './start-agent-hooks';
import { createFakeLogger } from '../logging/testing/fake-logger';

/** Port the fake hook server pretends to listen on. */
const HOOK_SERVER_PORT = 51234;

/** Folder below %APPDATA%\Argus that holds the hook settings files. */
const HOOKS_DIRECTORY = 'C:\\Users\\Viper\\AppData\\Roaming\\Argus\\hooks';

const TOKEN = 'generated-token';

describe('startAgentHooks', () => {
  let startHookServer: Mock<(options: HookServerOptions) => Promise<HookServer>>;
  let writeFile: Mock<WriteHookSettingsFile>;
  let logError: Mock<Logger['error']>;

  beforeEach(() => {
    startHookServer = vi.fn(() =>
      Promise.resolve({ port: HOOK_SERVER_PORT, close: () => Promise.resolve() }),
    );
    writeFile = vi.fn(() => Promise.resolve());
    logError = vi.fn();
  });

  /**
   * Runs the function under test with the shared fakes.
   * @param adapter The only adapter; by default one whose settings are valid.
   * @returns Its result.
   */
  function start(
    adapter: AgentTypeAdapter = createFakeAgentTypeAdapter(),
  ): ReturnType<typeof startAgentHooks> {
    return startAgentHooks({
      adapters: [adapter],
      hooksDirectory: HOOKS_DIRECTORY,
      startHookServer,
      writeFile,
      generateToken: () => TOKEN,
      onHookEvent: vi.fn(),
      logger: createFakeLogger({ error: logError }),
    });
  }

  it('startAgentHooks_WhenServerListens_WritesSettingsFileWithItsPortPerAgentType', async () => {
    // Act
    await start();

    // Assert: the port only exists once the server listens, so the file must come after it
    expect(writeFile).toHaveBeenCalledOnce();
    const [path, content] = writeFile.mock.calls[0] ?? [];
    expect(path).toBe('C:\\Users\\Viper\\AppData\\Roaming\\Argus\\hooks\\claude-code.json');
    expect(JSON.parse(content ?? '')).toEqual({ fakeHookPort: 51234 });
  });

  it('startAgentHooks_WhenFileWritten_ReturnsTokenAndSettingsPath', async () => {
    // Act
    const hooks = await start();

    // Assert: the agent session needs both, the token as ARGUS_TOKEN and the path for --settings
    expect(hooks.isAvailable).toBe(true);
    if (!hooks.isAvailable) {
      return;
    }
    expect(hooks.token).toBe(TOKEN);
    expect(hooks.hookSettingsPath('claude-code')).toBe(
      'C:\\Users\\Viper\\AppData\\Roaming\\Argus\\hooks\\claude-code.json',
    );
    expect(startHookServer).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }));
  });

  it('startAgentHooks_WhenServerCannotListen_ReportsUnavailableAndLogsError', async () => {
    // Arrange
    const listenError = new Error('listen EACCES: permission denied 127.0.0.1');
    startHookServer.mockRejectedValue(listenError);

    // Act
    const hooks = await start();

    // Assert: the app still starts, only agent sessions cannot (concept 5.3)
    expect(hooks).toEqual({ isAvailable: false });
    expect(writeFile).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('Agent hooks unavailable', { error: listenError });
  });

  it.each([
    ['WriteFails', 'EPERM: operation not permitted', 'write'],
    ['AdapterThrows', 'Port out of range', 'build'],
  ] as const)(
    'startAgentHooks_When%s_ReportsUnavailableLogsErrorAndClosesServer',
    async (_case, message, failingStep) => {
      // Arrange: without a valid file Claude would run without hooks, so no status at all
      const failure = new Error(message);
      const closeServer = vi.fn(() => Promise.resolve());
      startHookServer.mockResolvedValue({ port: HOOK_SERVER_PORT, close: closeServer });
      if (failingStep === 'write') {
        writeFile.mockRejectedValue(failure);
      }
      const adapter = createFakeAgentTypeAdapter(
        failingStep === 'build'
          ? {
              buildHookSettings: () => {
                throw failure;
              },
            }
          : {},
      );

      // Act
      const hooks = await start(adapter);

      // Assert
      expect(hooks).toEqual({ isAvailable: false });
      expect(logError).toHaveBeenCalledWith('Agent hooks unavailable', { error: failure });
      expect(closeServer).toHaveBeenCalledOnce();
    },
  );

  it('startAgentHooks_WhenSchemaOfAdapterRejectsSettings_WritesNoFileAndReportsUnavailable', async () => {
    // Arrange: the core validates, so an adapter that forgets to cannot write an invalid file,
    // which Claude would silently ignore as a whole (concept 5.3)
    const adapter = createFakeAgentTypeAdapter({
      hookSettingsSchema: z.object({ fakeHookPort: z.string() }).strict(),
    });

    // Act
    const hooks = await start(adapter);

    // Assert
    expect(hooks).toEqual({ isAvailable: false });
    expect(writeFile).not.toHaveBeenCalled();
    const [message, context] = logError.mock.calls[0] ?? [];
    expect(message).toBe('Agent hooks unavailable');
    expect(context?.error).toBeInstanceOf(z.ZodError);
  });
});
