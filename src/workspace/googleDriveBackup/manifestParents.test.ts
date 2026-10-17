import { describe, expect, it, vi } from 'vitest';
import { driveAppPropertiesError } from './driveAppProperties';
import { GoogleDriveApi } from './googleDriveApi';
import { manifestParentIds, manifestParentProperties } from './manifestParents';
import { findDriveManifestHeads } from './manifestHistory';

const id = (index: number) => `1${String(index).padStart(32, '0')}`;
const file = (appProperties: Record<string, string>) => ({ id: 'snapshot', name: 'manifest.xlsx', appProperties });
const malformedParentProperties: Record<string, string>[] = [
  { parentManifestIdsParts: '2', parentManifestIds: '["first"]' },
  { parentManifestIdsParts: '2', parentManifestIds1: '["second"]' },
  { parentManifestIdsParts: '2', parentManifestIds: '["first"]', parentManifestIds1: 'broken' },
  { parentManifestIdsParts: '2', parentManifestIds: '["first"]', parentManifestIds1: '[42]' },
  { parentManifestIdsParts: '0', parentManifestIds: '[]' },
  { parentManifestIdsParts: '31', parentManifestIds: '[]' },
  { parentManifestIds: '["first"]', parentManifestIds1: '["second"]' },
  { parentManifestIdsParts: '2', parentManifestIds: '["first"]', parentManifestIds1: '["second"]', parentManifestIds2: '["extra"]' },
];

describe('Drive manifest parent metadata encoding', () => {
  it.each([0, 1, 2])('keeps the existing single-array format for %i parents', count => {
    const parents = Array.from({ length: count }, (_, index) => id(index));
    expect(manifestParentProperties(parents)).toEqual({ parentManifestIds: JSON.stringify(parents) });
  });

  it.each([3, 27])('round-trips all %i real-length parent IDs within Drive limits', count => {
    const parents = Array.from({ length: count }, (_, index) => id(index));
    const properties = manifestParentProperties(parents);
    expect(manifestParentIds(file(properties))).toEqual(parents);
    expect(driveAppPropertiesError(properties)).toBeUndefined();
    for (const [key, value] of Object.entries(properties)) {
      expect(new TextEncoder().encode(key + value).byteLength).toBeLessThanOrEqual(124);
    }
    const ancestors = parents.map(parent => ({ id: parent, name: 'manifest.xlsx', appProperties: { parentManifestIds: '[]' } }));
    expect(findDriveManifestHeads([file(properties), ...ancestors]).map(head => head.id)).toEqual(['snapshot']);
  });

  it('counts UTF-8 bytes while splitting instead of counting JavaScript characters', () => {
    const parents = ['甲'.repeat(20), '乙'.repeat(20), '丙'.repeat(20)];
    const properties = manifestParentProperties(parents);
    expect(Object.keys(properties).filter(key => key !== 'parentManifestIdsParts')).toHaveLength(3);
    expect(manifestParentIds(file(properties))).toEqual(parents);
    expect(driveAppPropertiesError(properties)).toBeUndefined();
  });

  it('accepts an exact byte boundary and never truncates an oversized identifier', () => {
    expect(manifestParentIds(file(manifestParentProperties(['x'.repeat(103)])))).toEqual(['x'.repeat(103)]);
    expect(() => manifestParentProperties(['x'.repeat(104)])).toThrow('長度限制');
  });

  it.each(malformedParentProperties)('rejects incomplete or malformed segmented ancestry %#', properties => {
    expect(() => findDriveManifestHeads([file(properties)])).toThrow('版本關係不完整');
  });

  it('rejects invalid outgoing metadata before requesting an access token or uploading a body', async () => {
    const getAccessToken = vi.fn();
    const fetchImpl = vi.fn();
    const api = new GoogleDriveApi({ tokenProvider: { getAccessToken }, fetchImpl });
    await expect(api.uploadFile({ parentId: 'root', name: 'invalid', mimeType: 'application/json', body: '{}', appProperties: { key: '字'.repeat(41) } })).rejects.toMatchObject({ status: 400 });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
