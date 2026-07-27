import { describe, expect, test } from 'vitest';
import { cleanEditionNotes, parseEditionNotes } from './routes/shared';

describe('rule edition notes', () => {
  test('reads the multi-value JSON column and removes normalized duplicates', () => {
    expect(parseEditionNotes({
      edition_notes_json: JSON.stringify(['挪威人擴充', ' 挪威人擴充 ', '修訂版']),
      edition_note: '舊資料',
    })).toEqual(['挪威人擴充', '修訂版']);
  });

  test('falls back to the legacy single-value column', () => {
    expect(parseEditionNotes({ edition_notes_json: '[]', edition_note: '舊版擴充' }))
      .toEqual(['舊版擴充']);
  });

  test('limits the normalized set to twenty values', () => {
    expect(cleanEditionNotes(Array.from({ length: 25 }, (_, index) => `擴充 ${index}`))).toHaveLength(20);
  });
});
