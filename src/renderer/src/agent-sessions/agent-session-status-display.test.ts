import { describe, expect, it } from 'vitest';
import {
  AGENT_SESSION_STATUS_LABELS,
  formatAgentSessionStatusLine,
} from './agent-session-status-display';

describe('agent session status display', () => {
  it('AGENT_SESSION_STATUS_LABELS_UseGlossaryNames', () => {
    // Arrange: the German names of the glossary
    const expected = {
      working: 'Arbeitet',
      waiting: 'Wartet',
      ready: 'Bereit',
      failed: 'Fehler',
      ended: 'Beendet',
    };

    // Act
    const labels = AGENT_SESSION_STATUS_LABELS;

    // Assert
    expect(labels).toEqual(expected);
  });

  it('formatAgentSessionStatusLine_WithoutSubagents_ShowsOnlyStatus', () => {
    // Act
    const line = formatAgentSessionStatusLine('working', 0);

    // Assert
    expect(line).toBe('Arbeitet');
  });

  it('formatAgentSessionStatusLine_WithSubagents_AppendsTheirCount', () => {
    // Act
    const line = formatAgentSessionStatusLine('waiting', 2);

    // Assert: as sketched in concept 6
    expect(line).toBe('Wartet · 2 Sub');
  });
});
