import { describe, expect, it } from 'vitest';
import { encodePowerShellCommand } from './powershell';

describe('encodePowerShellCommand', () => {
  it('encodePowerShellCommand_WithUmlautEuroAndEmoji_ReturnsBase64OfUtf16Le', () => {
    // Arrange: expected value produced by PowerShell itself, the consumer of -EncodedCommand:
    // [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("ä€😀 'x'"))
    const script = "ä€😀 'x'";

    // Act
    const encoded = encodePowerShellCommand(script);

    // Assert
    expect(encoded).toBe('5ACsID3YAN4gACcAeAAnAA==');
  });
});
