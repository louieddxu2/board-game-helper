import type { DriveFile } from './types';
import { hasManifestParents, manifestParentIds } from './manifestParents';
export { DRIVE_PARENT_MANIFEST_IDS_PROPERTY, manifestParentIds } from './manifestParents';

export const DRIVE_BACKUP_FORK_COUNT_PROPERTY = 'backupForkCount';
export const DRIVE_ADOPTED_LEGACY_ID_PROPERTY = 'adoptedLegacyId';
export const DRIVE_ADOPTED_LEGACY_TIME_PROPERTY = 'adoptedLegacyTime';
export interface DriveLegacyBaseline { id: string; time: number }
export const sortManifestFiles = (files: DriveFile[]) => [...files].sort((left, right) => {
  const difference = Number(right.appProperties?.backedUpAt ?? 0) - Number(left.appProperties?.backedUpAt ?? 0);
  return difference || String(right.modifiedTime ?? right.createdTime ?? '').localeCompare(String(left.modifiedTime ?? left.createdTime ?? ''));
});
const isVersioned = hasManifestParents;
const versionedHeads = (files: DriveFile[]) => {
  const versioned = files.filter(isVersioned);
  const referenced = new Set(versioned.flatMap(manifestParentIds));
  return versioned.filter(file => !referenced.has(file.id));
};
const storedLegacyBaseline = (file: DriveFile): DriveLegacyBaseline | undefined => {
  const id = file.appProperties?.[DRIVE_ADOPTED_LEGACY_ID_PROPERTY];
  const time = Date.parse(file.appProperties?.[DRIVE_ADOPTED_LEGACY_TIME_PROPERTY] ?? '');
  return id && Number.isFinite(time) ? { id, time } : undefined;
};
const legacyBaseline = (file: DriveFile, historical = false): DriveLegacyBaseline | undefined => {
  // Without a recorded revision, creation time cannot hide later edits or trash updates.
  const time = Date.parse((historical ? file.createdTime : file.modifiedTime ?? file.createdTime) ?? '');
  return Number.isFinite(time) ? { id: file.id, time } : undefined;
};
const latestBaseline = (baselines: Array<DriveLegacyBaseline | undefined>) => baselines.reduce<DriveLegacyBaseline | undefined>(
  (latest, current) => current && (!latest || current.time > latest.time) ? current : latest, undefined,
);

/** Follow only adopted ancestry; unrelated trashed files cannot establish a baseline. */
export const adoptedDriveLegacyBaseline = (files: DriveFile[], historical: DriveFile[] = []): DriveLegacyBaseline | undefined => {
  const byId = new Map([...historical, ...files].map(file => [file.id, file]));
  const queue = versionedHeads(files);
  const seen = new Set<string>();
  let adopted: DriveLegacyBaseline | undefined;
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    const stored = isVersioned(file) ? storedLegacyBaseline(file) : undefined;
    if (stored) adopted = latestBaseline([adopted, stored]);
    else if (isVersioned(file)) {
      for (const id of manifestParentIds(file)) {
        const parent = byId.get(id);
        if (parent) queue.push(parent);
      }
    } else adopted = latestBaseline([adopted, legacyBaseline(file, true)]);
  }
  return adopted;
};

export const driveLegacyBaselineForBackup = (heads: DriveFile[], adopted?: DriveLegacyBaseline) => latestBaseline([
  adopted, ...heads.filter(file => !isVersioned(file)).map(file => legacyBaseline(file)),
]);

export const findDriveManifestHeads = (files: DriveFile[], adopted = adoptedDriveLegacyBaseline(files)): DriveFile[] => {
  const sorted = sortManifestFiles(files);
  const versioned = sorted.filter(isVersioned);
  if (!versioned.length) return sorted.slice(0, 1);
  const referenced = new Set(versioned.flatMap(manifestParentIds));
  const heads = versionedHeads(versioned);
  const legacy = sorted.find(file => {
    if (isVersioned(file)) return false;
    if (!adopted) return true;
    const time = Date.parse(file.modifiedTime ?? file.createdTime ?? '');
    return !Number.isFinite(time) || time > adopted.time || (time === adopted.time && file.id !== adopted.id);
  });
  if (legacy && (adopted || !referenced.has(legacy.id))) heads.push(legacy);
  return sortManifestFiles(heads);
};

export const needsDriveLegacyHistory = (files: DriveFile[]) => {
  const ids = new Set(files.map(file => file.id));
  return files.some(file => !isVersioned(file))
    && versionedHeads(files).some(file => !storedLegacyBaseline(file))
    && files.some(file => isVersioned(file) && manifestParentIds(file).some(id => !ids.has(id)))
    && findDriveManifestHeads(files).some(file => !isVersioned(file));
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
