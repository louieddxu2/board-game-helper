import { describe, expect, it } from 'vitest';
import { runWorkspaceCooperativeSteps } from './workspaceCooperativeWork';
import { safeSheetName, workbookFromRows, workbookFromRowsSteps, zipStoreBytes, zipStoreBytesAsync, type SpreadsheetSheet } from './spreadsheetWorkbook';

const bytesOf = async (blob: Blob) => {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  }));
};
const read16 = (bytes: Uint8Array, offset: number) => bytes[offset] | bytes[offset + 1] << 8;
const read32 = (bytes: Uint8Array, offset: number) => (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16 | bytes[offset + 3] << 24) >>> 0;

const readStoredEntries = async (blob: Blob) => {
  const bytes = await bytesOf(blob);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  while (offset + 4 <= bytes.length && read32(bytes, offset) === 0x04034b50) {
    const size = read32(bytes, offset + 18);
    const nameLength = read16(bytes, offset + 26);
    const extraLength = read16(bytes, offset + 28);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const contentStart = offset + 30 + nameLength + extraLength;
    entries.set(name, bytes.slice(contentStart, contentStart + size));
    offset = contentStart + size;
  }
  return { bytes, entries };
};

describe('streamed workbook package writer', () => {
  it('keeps sheet names within 31 UTF-16 units without splitting emoji or suffixes', () => {
    const used = new Set<string>();
    const emojiName = '😀'.repeat(16);
    const first = safeSheetName(emojiName, used);
    const second = safeSheetName(emojiName, used);
    const asciiFirst = safeSheetName('a'.repeat(31), used);
    const asciiSecond = safeSheetName('a'.repeat(31), used);
    expect(first.length).toBeLessThanOrEqual(31);
    expect(first).toBe('😀'.repeat(15));
    expect(second).toBe('😀'.repeat(14) + '-2');
    expect(asciiFirst).toHaveLength(31);
    expect(asciiSecond).toHaveLength(31);
    for (const name of [first, second, asciiFirst, asciiSecond]) {
      const last = name.at(-1)?.charCodeAt(0) ?? 0;
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('replays a lazy row factory for width measurement and XML generation', async () => {
    let calls = 0;
    const blob = workbookFromRows([{ name: 'lazy', rows: () => { calls += 1; return [['value', calls]]; } }]);
    const { entries } = await readStoredEntries(blob);
    const xml = new TextDecoder().decode(entries.get('xl/worksheets/sheet1.xml'));
    expect(calls).toBe(2);
    expect(xml).toContain('<c r="B1"><v>2</v></c>');
  });

  it('keeps sync and cooperative workbooks byte-identical across XML chunk boundaries', async () => {
    const long = `${'中文'.repeat(8190)}😀&<>"'`;
    const sheets: SpreadsheetSheet[] = [
        {
          name: 'A&B',
          rows: () => [
            ['標題', long, '', null],
            ['多行\n第二行', '<tag>&', 42],
          ],
        },
        { name: 'A&B', rows: [[, 'ragged']] },
    ];

    const sync = await bytesOf(workbookFromRows(sheets));
    const asyncBlob = await runWorkspaceCooperativeSteps(workbookFromRowsSteps(sheets), () => undefined);
    const streamed = await bytesOf(asyncBlob);
    expect(Array.from(streamed)).toEqual(Array.from(sync));

    const { entries } = await readStoredEntries(asyncBlob);
    const workbookXml = new TextDecoder().decode(entries.get('xl/workbook.xml'));
    const rootRelationships = new TextDecoder().decode(entries.get('_rels/.rels'));
    const firstSheetXml = new TextDecoder().decode(entries.get('xl/worksheets/sheet1.xml'));
    expect(workbookXml).toContain('name="A&amp;B"');
    expect(workbookXml).toContain('name="A&amp;B-2"');
    expect(rootRelationships).toContain('officeDocument" Target="xl/workbook.xml"');
    expect(firstSheetXml).toContain('dimension ref="A1:D2"');
    expect(firstSheetXml).toContain('&lt;tag&gt;&amp;');
    expect(firstSheetXml).toContain('😀');
    expect(firstSheetXml).not.toContain('\ufffd');
  });

  it('keeps ZIP local and central CRC values equal for known and chunked payloads', async () => {
    const known = await readStoredEntries(zipStoreBytes([{ name: 'hello.txt', content: new TextEncoder().encode('hello') }]));
    const localSize = read32(known.bytes, 18);
    const nameLength = read16(known.bytes, 26);
    const centralOffset = 30 + nameLength + localSize;
    expect(read32(known.bytes, 14)).toBe(0x3610a686);
    expect(read32(known.bytes, centralOffset + 16)).toBe(0x3610a686);

    const first = new Uint8Array(70_000).fill(65);
    const second = new Uint8Array([66, 67, 68]);
    const sync = await bytesOf(zipStoreBytes([{ name: 'large.bin', content: [first, second] }]));
    const streamed = await bytesOf(await zipStoreBytesAsync([{ name: 'large.bin', content: [first, second] }]));
    expect(Array.from(streamed)).toEqual(Array.from(sync));
    const parsed = await readStoredEntries(new Blob([sync]));
    const size = read32(sync, 18);
    const nameBytes = read16(sync, 26);
    const central = 30 + nameBytes + size;
    expect(parsed.entries.get('large.bin')).toHaveLength(70_003);
    expect(read32(sync, 14)).toBe(read32(sync, central + 16));
    expect(read32(sync, 18)).toBe(read32(sync, central + 20));
  });
});
