/** Reads window titles (OSC 0 and OSC 2) from the output stream of a terminal. */
export interface TerminalTitleParser {
  /**
   * Scans the next output chunk. Sequences may be split across chunks.
   * @param chunk Output of the terminal, unchanged.
   * @returns Every title completed in this chunk, in order.
   */
  feed(chunk: string): string[];
}

/** Escape character, starts every control sequence. */
const ESC = '\x1b';
/** Second character of an OSC sequence (`ESC ]`). */
const OSC_INTRODUCER = ']';
/** Bell, the end of an OSC sequence most programs use. */
const BEL = '\x07';
/** Second character of the string terminator (`ESC \`), the standard end of an OSC sequence. */
const STRING_TERMINATOR_FINAL = '\\';

/**
 * Longest OSC body the parser keeps. Titles are short; the bound only stops a sequence that never
 * ends (e.g. a crashed program) from growing the buffer with all following output.
 */
export const MAX_OSC_LENGTH = 4096;

/** OSC commands that set the window title: 0 = icon name and title, 2 = title. */
const TITLE_COMMANDS: readonly string[] = ['0', '2'];
/** Separates the OSC command number from its text. */
const OSC_PARAMETER_SEPARATOR = ';';

/**
 * Where the parser stands: in plain output, after an ESC, inside an OSC sequence, or after an
 * ESC inside it (possibly the start of its string terminator).
 */
type ParserState = 'text' | 'escape' | 'osc' | 'osc-escape';

/**
 * Creates a title parser for one terminal; node-pty has no title event, so Argus reads the
 * sequences itself (concept 4, TerminalService).
 * @returns The parser.
 */
export function createTerminalTitleParser(): TerminalTitleParser {
  let state: ParserState = 'text';
  /** Body of the OSC sequence read so far, e.g. `0;✳ Claude Code`. */
  let oscBody = '';

  return {
    feed: (chunk) => {
      const titles: string[] = [];
      /** Ends the current OSC sequence and keeps its title, if it sets one. */
      const finishOsc = (): void => {
        const title = toTitle(oscBody);
        if (title !== null) {
          titles.push(title);
        }
        state = 'text';
      };
      for (const character of chunk) {
        if (state === 'osc') {
          if (character === BEL) {
            finishOsc();
          } else if (character === ESC) {
            state = 'osc-escape';
          } else if (oscBody.length < MAX_OSC_LENGTH) {
            oscBody += character;
          } else {
            // Not a title any more; drop it and read the rest as plain output.
            state = 'text';
            oscBody = '';
          }
        } else if (state === 'osc-escape' && character === STRING_TERMINATOR_FINAL) {
          finishOsc();
        } else if (state === 'escape' || state === 'osc-escape') {
          // An ESC inside an OSC that is not ST cancels it and starts a new sequence.
          state = character === OSC_INTRODUCER ? 'osc' : 'text';
          oscBody = '';
        } else if (character === ESC) {
          state = 'escape';
        }
      }
      return titles;
    },
  };
}

/**
 * Extracts the title from a complete OSC body.
 * @param oscBody E.g. `0;✳ Claude Code` or `7;file://…`.
 * @returns The title, or `null` if the sequence does not set one.
 */
function toTitle(oscBody: string): string | null {
  const separatorIndex = oscBody.indexOf(OSC_PARAMETER_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }
  const command = oscBody.slice(0, separatorIndex);
  return TITLE_COMMANDS.includes(command) ? oscBody.slice(separatorIndex + 1) : null;
}
