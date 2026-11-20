/**
 * Raised when the renderer asks to close the terminal of a running agent session. Its tab offers
 * no close button (concept 5.3, step 5), so the request means a bug or an untrusted renderer.
 */
export class AgentSessionTerminalCloseError extends Error {
  /**
   * @param terminalId Terminal of the agent session that was asked to close.
   */
  constructor(readonly terminalId: string) {
    super(`Terminal ${terminalId} runs an agent session and cannot be closed`);
    this.name = 'AgentSessionTerminalCloseError';
  }
}
