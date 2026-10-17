import type { DriveFile } from './types';
import { DRIVE_APP_PROPERTY_MAX_BYTES, DRIVE_APP_PROPERTY_MAX_COUNT, driveAppPropertyBytes } from './driveAppProperties';

export const DRIVE_PARENT_MANIFEST_IDS_PROPERTY = 'parentManifestIds';
const PARTS_PROPERTY = 'parentManifestIdsParts';
const partKey = (index: number) => `${DRIVE_PARENT_MANIFEST_IDS_PROPERTY}${index || ''}`;
const invalidParents = () => new Error('雲端備份的版本關係不完整，無法安全繼續備份');
const numberedPart = (key: string) => /^parentManifestIds\d+$/.test(key);
export const hasManifestParents = (file: DriveFile) => Object.keys(file.appProperties ?? {}).some(key =>
  key === DRIVE_PARENT_MANIFEST_IDS_PROPERTY || key === PARTS_PROPERTY || numberedPart(key),
);

/** Keep the original array for small histories; each additional array fits one Drive property. */
export const manifestParentProperties = (ids: string[]): Record<string, string> => {
  const properties: Record<string, string> = {};
  let index = 0;
  let part: string[] = [];
  for (const id of ids) {
    if (driveAppPropertyBytes(partKey(index), JSON.stringify([...part, id])) > DRIVE_APP_PROPERTY_MAX_BYTES && part.length) {
      properties[partKey(index)] = JSON.stringify(part);
      index += 1;
      part = [];
    }
    part.push(id);
    if (driveAppPropertyBytes(partKey(index), JSON.stringify(part)) > DRIVE_APP_PROPERTY_MAX_BYTES) {
      throw new Error('Google Drive 備份版本識別碼超過長度限制');
    }
  }
  properties[partKey(index)] = JSON.stringify(part);
  if (index) properties[PARTS_PROPERTY] = String(index + 1);
  return properties;
};

export const manifestParentIds = (file: DriveFile): string[] => {
  const properties = file.appProperties ?? {};
  const serialized = properties[DRIVE_PARENT_MANIFEST_IDS_PROPERTY];
  const parts = properties[PARTS_PROPERTY];
  if (parts === undefined) {
    if (Object.keys(properties).some(numberedPart)) throw invalidParents();
    if (serialized === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(serialized);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  }
  const count = Number(parts);
  if (!/^[1-9]\d*$/.test(parts) || count > DRIVE_APP_PROPERTY_MAX_COUNT) throw invalidParents();
  if (Object.keys(properties).filter(numberedPart).some(key => {
    const index = Number(key.slice(DRIVE_PARENT_MANIFEST_IDS_PROPERTY.length));
    return index < 1 || index >= count || partKey(index) !== key;
  })) throw invalidParents();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const parsed: unknown = JSON.parse(properties[partKey(index)]);
      if (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string')) throw invalidParents();
      ids.push(...parsed);
    } catch { throw invalidParents(); }
  }
  return ids;
};
