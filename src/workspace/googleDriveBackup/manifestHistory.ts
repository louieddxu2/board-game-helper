import type { DriveFile } from './types';

export const DRIVE_PARENT_MANIFEST_IDS_PROPERTY = 'parentManifestIds';
export const DRIVE_BACKUP_FORK_COUNT_PROPERTY = 'backupForkCount';
export const sortManifestFiles = (files: DriveFile[]) => [...files].sort((left, right) => {
  const difference = Number(right.appProperties?.backedUpAt ?? 0) - Number(left.appProperties?.backedUpAt ?? 0);
  return difference || String(right.modifiedTime ?? right.createdTime ?? '').localeCompare(String(left.modifiedTime ?? left.createdTime ?? ''));
});
export const manifestParentIds = (file: DriveFile): string[] => {
  const serialized = file.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY];
  if (serialized === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
};
export const findDriveManifestHeads = (files: DriveFile[]): DriveFile[] => {
  const sorted = sortManifestFiles(files);
  const versioned = sorted.filter(file => file.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY] !== undefined);
  if (!versioned.length) return sorted.slice(0, 1);
  const referenced = new Set(versioned.flatMap(manifestParentIds));
  const heads = versioned.filter(file => !referenced.has(file.id));
  const legacy = sorted.find(file => file.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY] === undefined);
  if (legacy && !referenced.has(legacy.id)) heads.push(legacy);
  return sortManifestFiles(heads);
};

/** Follow publication ancestry before wall-clock order, including resolved branches. */
export const retainedDriveManifests = (files: DriveFile[], headId: string, limit: number) => {
  const byId = new Map(files.map(file => [file.id, file]));
  const retained: DriveFile[] = [];
  const seen = new Set<string>();
  const queue = [headId];
  while (queue.length && retained.length < limit) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const file = byId.get(id);
    if (!file) continue;
    retained.push(file);
    queue.push(...manifestParentIds(file));
  }
  for (const file of sortManifestFiles(files)) if (retained.length < limit && !seen.has(file.id)) retained.push(file);
  return retained;
};
