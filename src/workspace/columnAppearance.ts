export const workspaceColumnBackgroundPalette = [
  { value: '', label: '預設' },
  { value: '#F7EED8', label: '奶油' },
  { value: '#EAF2E8', label: '淡綠' },
  { value: '#E8F0F7', label: '淡藍' },
  { value: '#EEE9F5', label: '淡紫' },
  { value: '#F6E9E5', label: '淡粉' },
  { value: '#EEF0EC', label: '淡灰' },
] as const;

const backgrounds = new Set<string>(workspaceColumnBackgroundPalette.map(color => color.value).filter(Boolean));

/** Keep imported decoration within the same light palette as the editor. */
export const normalizeWorkspaceColumnBackground = (value: unknown): string | undefined => {
  const color = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return backgrounds.has(color) ? color : undefined;
};
