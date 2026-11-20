/**
 * Generic families the font is compared against. One is not enough: if the font happens to be
 * what a generic family resolves to (e.g. Consolas for `monospace`), their widths are equal.
 */
const GENERIC_FONT_FAMILIES = ['monospace', 'serif', 'sans-serif'] as const;

/** Large size, so small width differences between fonts become measurable. */
const MEASURE_FONT_SIZE_PX = 72;

/** Characters whose widths differ a lot between fonts. */
const MEASURE_SAMPLE_TEXT = 'mmmmmmmmmmlli1WwQ@#';

/**
 * Tells whether a font is installed. `document.fonts.check` cannot be used: in Electron it
 * returns `true` even for fonts that do not exist (verified in #21). Instead the text width with
 * the font plus a generic fallback is compared with the generic family alone; a different width
 * means the font was used.
 * @param fontName One font family name as validated by `settingsSchema`.
 * @returns `true` if the font is installed; `true` as well if no canvas is available, so the
 *   dialog never warns without reason.
 */
export function isFontInstalled(fontName: string): boolean {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) {
    return true;
  }
  /**
   * Measures the sample text in a CSS font shorthand.
   * @param font E.g. `72px "Consolas", monospace`.
   * @returns Width of the sample text in pixels.
   */
  const measureWidth = (font: string): number => {
    context.font = font;
    return context.measureText(MEASURE_SAMPLE_TEXT).width;
  };
  return GENERIC_FONT_FAMILIES.some(
    (genericFamily) =>
      measureWidth(`${String(MEASURE_FONT_SIZE_PX)}px "${fontName}", ${genericFamily}`) !==
      measureWidth(`${String(MEASURE_FONT_SIZE_PX)}px ${genericFamily}`),
  );
}
