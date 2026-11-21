import { describe, expect, it } from 'vitest';
import { createTerminalTitleParser, MAX_OSC_LENGTH } from './terminal-title-parser';

/** Escape character, starts every control sequence. */
const ESC = '\x1b';
/** Bell, the usual end of an OSC sequence. */
const BEL = '\x07';
/** String terminator, the standard end of an OSC sequence. */
const ST = `${ESC}\\`;

describe('createTerminalTitleParser', () => {
  it('feed_ChunkWithOsc0EndedByBell_ReturnsTitle', () => {
    // Arrange
    const parser = createTerminalTitleParser();

    // Act
    const titles = parser.feed(`Hallo${ESC}]0;✳ Claude Code${BEL}Welt`);

    // Assert
    expect(titles).toEqual(['✳ Claude Code']);
  });

  it('feed_Osc2EndedByStringTerminator_ReturnsTitle', () => {
    // Arrange
    const parser = createTerminalTitleParser();

    // Act
    const titles = parser.feed(`${ESC}]2;◐ Claude Code${ST}prompt>`);

    // Assert
    expect(titles).toEqual(['◐ Claude Code']);
  });

  /** Output with one title; every split position is tried, including inside ESC ] and ST. */
  const OUTPUT_WITH_TITLE = `vorher${ESC}]0;✳ Claude Code${ST}nachher`;

  it.each([...Array(OUTPUT_WITH_TITLE.length + 1).keys()])(
    'feed_TitleSplitAtPosition%i_ReturnsItOnceWhenComplete',
    (splitIndex) => {
      // Arrange
      const parser = createTerminalTitleParser();

      // Act
      const titles = [
        ...parser.feed(OUTPUT_WITH_TITLE.slice(0, splitIndex)),
        ...parser.feed(OUTPUT_WITH_TITLE.slice(splitIndex)),
      ];

      // Assert
      expect(titles).toEqual(['✳ Claude Code']);
    },
  );

  it('feed_OtherOscCommandsAndEscapeSequences_ReturnsNoTitle', () => {
    // Arrange: working directory (OSC 7), a color change (CSI) and a hyperlink (OSC 8).
    const parser = createTerminalTitleParser();

    // Act
    const titles = parser.feed(
      `${ESC}]7;file://localhost/D:/Worktrees${BEL}${ESC}[31mrot${ESC}[0m${ESC}]8;;https://x${ST}`,
    );

    // Assert
    expect(titles).toEqual([]);
  });

  it('feed_TwoTitlesInOneChunk_ReturnsBothInOrder', () => {
    // Arrange: the spinner glyph of a working Claude alternates every second (ADR 0005).
    const parser = createTerminalTitleParser();

    // Act
    const titles = parser.feed(`${ESC}]0;◐ Claude Code${BEL}text${ESC}]0;◑ Claude Code${BEL}`);

    // Assert
    expect(titles).toEqual(['◐ Claude Code', '◑ Claude Code']);
  });

  it('feed_UnterminatedOverlongOsc_DropsItAndRecognisesNextTitle', () => {
    // Arrange: a sequence that never ends must not grow the buffer without bound.
    const parser = createTerminalTitleParser();
    parser.feed(`${ESC}]0;${'x'.repeat(MAX_OSC_LENGTH + 1)}`);

    // Act
    const titles = parser.feed(`${BEL}${ESC}]0;✳ Claude Code${BEL}`);

    // Assert
    expect(titles).toEqual(['✳ Claude Code']);
  });
});
