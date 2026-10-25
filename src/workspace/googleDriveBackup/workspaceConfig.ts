/** Public configuration only. No website session or Google credential is sent to the application server. */
export const loadWorkspaceGoogleDriveClientId = async (): Promise<string | null> => {
  const response = await fetch('/api/workspace-config', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('無法讀取 Google Drive 設定，請稍後再試');
  const value = await response.json();
  return typeof value.googleDriveClientId === 'string' && value.googleDriveClientId.trim() ? value.googleDriveClientId.trim() : null;
};
