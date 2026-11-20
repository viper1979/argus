import { describe, expect, it } from 'vitest';
import { validateFontDraft } from './terminal-font-draft';

/** Message of every invalid size, as the user sees it. */
const FONT_SIZE_MESSAGE = 'Die Schriftgröße muss eine ganze Zahl von 8 bis 32 sein.';

describe('validateFontDraft', () => {
  it('validateFontDraft_WithValidInput_ReturnsTrimmedFontAndNumber', () => {
    // Arrange
    const draft = { fontFamily: '  MesloLGS NF ', fontSize: '14' };

    // Act
    const result = validateFontDraft(draft);

    // Assert
    expect(result).toEqual({ ok: true, font: { fontFamily: 'MesloLGS NF', fontSize: 14 } });
  });

  it.each([
    ['empty', ''],
    ['only spaces', '  '],
    ['not a number', 'abc'],
    ['fraction', '12.5'],
  ])('validateFontDraft_WithInvalidSize_ReturnsGermanSizeMessage (%s)', (_case, fontSize) => {
    // Arrange
    const draft = { fontFamily: 'Consolas', fontSize };

    // Act
    const result = validateFontDraft(draft);

    // Assert
    expect(result).toEqual({ ok: false, errors: { fontSize: FONT_SIZE_MESSAGE } });
  });

  it('validateFontDraft_WithBothFieldsInvalid_ReturnsOneMessagePerField', () => {
    // Arrange: an empty name breaks the minimum length and the name pattern, size is out of range
    const draft = { fontFamily: '', fontSize: '40' };

    // Act
    const result = validateFontDraft(draft);

    // Assert
    expect(result).toEqual({
      ok: false,
      errors: {
        fontFamily: 'Die Terminal-Schrift darf nicht leer sein.',
        fontSize: FONT_SIZE_MESSAGE,
      },
    });
  });
});
