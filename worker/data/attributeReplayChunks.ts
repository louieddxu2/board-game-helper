const encoder = new TextEncoder();

export const encodeAttributeReplayChunks = (rows: unknown[][], maxBytes = 1_000_000): string[] => {
  const chunks: string[] = [];
  let entries: string[] = [];
  let bytes = 2;
  for (const row of rows) {
    const json = JSON.stringify(row);
    const size = encoder.encode(json).byteLength;
    if (size + 2 > maxBytes) throw new Error('attribute_replay_entry_too_large');
    if (bytes + size + (entries.length ? 1 : 0) > maxBytes) {
      chunks.push(`[${entries.join(',')}]`);
      entries = [];
      bytes = 2;
    }
    bytes += size + (entries.length ? 1 : 0);
    entries.push(json);
  }
  chunks.push(`[${entries.join(',')}]`);
  return chunks;
};
