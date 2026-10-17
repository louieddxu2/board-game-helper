export const DRIVE_APP_PROPERTY_MAX_BYTES = 124;
export const DRIVE_APP_PROPERTY_MAX_COUNT = 30;
export const driveAppPropertyBytes = (key: string, value: string) => new TextEncoder().encode(key + value).byteLength;

export const driveAppPropertiesError = (properties?: Record<string, string>) => {
  if (!properties) return undefined;
  if (Object.keys(properties).length > DRIVE_APP_PROPERTY_MAX_COUNT) return 'Google Drive 備份資訊超過 30 個欄位的限制';
  const oversized = Object.entries(properties).find(([key, value]) => driveAppPropertyBytes(key, value) > DRIVE_APP_PROPERTY_MAX_BYTES);
  return oversized ? `Google Drive 備份資訊超過 124 bytes 限制：${oversized[0]}` : undefined;
};
