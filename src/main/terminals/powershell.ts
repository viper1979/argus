/**
 * Turns a value into a PowerShell string literal in single quotes. Inside single quotes only `'`
 * is special and is escaped by doubling it; `$`, backticks and `"` stay literal (verified in the
 * spike for ADR 0003).
 * @param value Any text, e.g. a start prompt or a path.
 * @returns The quoted literal, ready to embed in a PowerShell command.
 */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Encodes a script for `pwsh -EncodedCommand`: Base64 of its UTF-16LE bytes. The script then
 * reaches PowerShell without passing through command-line parsing, so quotes, `$` and umlauts
 * arrive unchanged (ADR 0003, spike).
 * @param script The PowerShell script.
 * @returns The Base64 text for the `-EncodedCommand` argument.
 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}
