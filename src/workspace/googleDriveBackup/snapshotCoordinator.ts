import type { BeginDriveSnapshot, DriveSnapshotOperation, DriveSnapshotState } from '../../shared/driveSnapshots';
export { SnapshotCoordinatorError } from './snapshotErrors';
export { createDriveSnapshotCoordinator as createSnapshotCoordinator } from './driveSnapshotCoordinator';

/** Implemented entirely by browser-to-Google-Drive requests; no app server storage. */
export interface SnapshotCoordinator {
  state(rootId?: string): Promise<DriveSnapshotState>;
  operation(id: string): Promise<DriveSnapshotOperation | null>;
  begin(input: BeginDriveSnapshot): Promise<DriveSnapshotOperation>;
  renew(id: string): Promise<void>;
  commit(id: string): Promise<DriveSnapshotOperation>;
  restore(id: string, leaseId: string, action: 'acquire' | 'verify' | 'release'): Promise<DriveSnapshotOperation>;
  cleanup(): Promise<{ cleaned: boolean }>;
}
