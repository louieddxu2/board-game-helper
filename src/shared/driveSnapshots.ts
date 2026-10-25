/** Drive file-format identifiers and public OAuth scopes; no server coordination API. */
export const DRIVE_SNAPSHOT_KEY = 'dynamic-sheet-primary-workspace-v3';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_SNAPSHOT_SCOPES = `openid ${DRIVE_FILE_SCOPE}`;
export const DRIVE_SNAPSHOT_LIMIT = 3;
export const DRIVE_SNAPSHOT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
