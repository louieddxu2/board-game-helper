import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { queryAttributeExpansionMetadata, updateAttributeExpansionMetadata } from './data/attributes';

const statement = (overrides: Partial<DatabaseStatement> = {}): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  ...overrides,
});

describe('attribute expansion metadata', () => {
  test('reads English names and aliases as attribute-only component metadata', async () => {
    const prepared = statement({ all: vi.fn().mockResolvedValue({ results: [{
      subject_id: 'config-1', component_order: 1, display_name: '遊戲＋擴充',
      base_game_name: '遊戲', expansion_name: '擴充', english_name: 'Expansion',
      aliases_json: '["Short name"]', bgg_id: 12345,
    }] }) });
    const db = { statement: vi.fn().mockReturnValue(prepared) } as unknown as Database;

    await expect(queryAttributeExpansionMetadata(db)).resolves.toEqual([{
      subjectId: 'config-1', componentOrder: 1, displayName: '遊戲＋擴充',
      baseGameName: '遊戲', expansionName: '擴充', englishName: 'Expansion',
      aliases: ['Short name'], bggId: 12345,
    }]);
    expect(db.statement).toHaveBeenCalledWith(expect.stringContaining('attribute_subject_component_aliases'));
  });

  test('updates only the expansion component and filters duplicate canonical aliases', async () => {
    const first = statement({ first: vi.fn().mockResolvedValue({ label: '威尼斯擴' }) });
    const final = statement({ all: vi.fn().mockResolvedValue({ results: [{
      subject_id: 'config-1', component_order: 1, display_name: '馬可波羅＋威尼斯擴',
      base_game_name: '馬可波羅', expansion_name: '威尼斯擴', english_name: 'Agents of Venice',
      aliases_json: '["Venice Agent", "Venice Agents"]', bgg_id: 232945,
    }] }) });
    const generic = statement();
    const statements = [first, generic, generic, generic, generic, final];
    const db = {
      statement: vi.fn().mockImplementation(() => statements.shift() ?? generic),
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    await updateAttributeExpansionMetadata(db, 'config-1', 1, {
      englishName: 'Agents of Venice',
      aliases: ['威尼斯擴', 'Agents of Venice', 'Venice Agents', 'Venice Agent', 'Venice Agents'],
    });

    expect(db.batch).toHaveBeenCalledOnce();
    const batch = (db.batch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as DatabaseStatement[];
    expect(batch).toHaveLength(4);
    expect((db.statement as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain('SET english_name = ?');
    expect((db.statement as unknown as ReturnType<typeof vi.fn>).mock.calls[2][0]).toContain('DELETE FROM attribute_subject_component_aliases');
    expect((db.statement as unknown as ReturnType<typeof vi.fn>).mock.calls[3][0]).toContain('INSERT INTO attribute_subject_component_aliases');
  });
});
