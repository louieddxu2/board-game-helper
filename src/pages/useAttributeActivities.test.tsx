import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../lib/api';
import { localDb } from '../lib/localDb';
import type { ActivityCache } from '../lib/attributeActivityCache';
import type { AttributeActivity } from '../shared/types';
import { useAttributeActivities } from './useAttributeActivities';
import { StrictMode, createElement } from 'react';

const a = { id: 'a', slug: 'a', kind: 'game' as const, displayName: '甲' };
const b = { id: 'b', slug: 'b', kind: 'game' as const, displayName: '乙' };
const comparison: AttributeActivity = { id: 'c', kind: 'comparison', actorName: '玩家', attributeId: 'luck', attributeName: '運氣', subjectA: a, subjectB: b, result: 'A_HIGHER', createdAt: 10 };
let cache: ActivityCache | undefined;

beforeEach(() => {
  cache = undefined;
  vi.spyOn(localDb, 'getAttributeActivities').mockImplementation(async () => cache);
  vi.spyOn(localDb, 'updateAttributeActivities').mockImplementation(async (update) => {
    cache = { key: 'attributes:activities:v1', cachedAt: update.invalidate ? 0 : update.server ? Date.now() : cache?.cachedAt ?? 0,
      data: { server: update.server ?? cache?.data.server ?? [], confirmed: update.confirmed ? [update.confirmed, ...(cache?.data.confirmed ?? [])] : cache?.data.confirmed ?? [] } };
    return cache;
  });
  vi.spyOn(api, 'attributeActivities').mockResolvedValue({ activities: [] });
});
afterEach(() => vi.restoreAllMocks());

test('fetches once on a cache miss and reuses the feed after reopening', async () => {
  vi.mocked(api.attributeActivities).mockResolvedValue({ activities: [comparison] });
  const first = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(first.result.current.activities).toEqual([comparison]));
  first.unmount();
  const next = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(next.result.current.activities).toEqual([comparison]));
  expect(api.attributeActivities).toHaveBeenCalledTimes(1);
});

test('loads only once under StrictMode effect replay', async () => {
  vi.mocked(api.attributeActivities).mockResolvedValue({ activities: [comparison] });
  const page = renderHook(() => useAttributeActivities(), { wrapper: ({ children }) => createElement(StrictMode, null, children) });
  await waitFor(() => expect(page.result.current.activities).toEqual([comparison]));
  expect(api.attributeActivities).toHaveBeenCalledTimes(1);
});

test('keeps the stale cache if revalidation fails', async () => {
  cache = { key: 'attributes:activities:v1', cachedAt: 1, data: { server: [comparison], confirmed: [] } };
  vi.mocked(api.attributeActivities).mockRejectedValue(new Error('offline'));
  const page = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(api.attributeActivities).toHaveBeenCalledTimes(1));
  expect(page.result.current.activities).toEqual([comparison]);
  expect(cache.cachedAt).toBe(1);
});

test('persists the confirmed vote with ratings and deduplicates it against the feed', async () => {
  cache = { key: 'attributes:activities:v1', cachedAt: Date.now(), data: { server: [], confirmed: [] } };
  const page = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(page.result.current.activities).toEqual([]));
  await act(async () => page.result.current.confirm([comparison, { ...comparison, id: 'rating', kind: 'rating', subject: a, value: 8 }], 'vote-1'));
  page.unmount();
  const reopened = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(reopened.result.current.activities?.[0]).toMatchObject({ responseId: 'vote-1', ratingA: 8 }));
  cache!.data.server = [{ ...comparison, responseId: 'vote-1' }];
  reopened.unmount();
  const third = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(third.result.current.activities).toHaveLength(1));
  expect(api.attributeActivities).not.toHaveBeenCalled();
});

test('keeps a confirmed vote when a previously started feed request finishes later', async () => {
  let resolve!: (value: { activities: AttributeActivity[] }) => void;
  vi.mocked(api.attributeActivities).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const page = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(api.attributeActivities).toHaveBeenCalled());
  await act(async () => page.result.current.confirm([comparison], 'vote-1'));
  await act(async () => resolve({ activities: [] }));
  expect(page.result.current.activities).toEqual([expect.objectContaining({ responseId: 'vote-1' })]);
});

test('marks the feed stale after an idempotent retry without a returned activity', async () => {
  cache = { key: 'attributes:activities:v1', cachedAt: Date.now(), data: { server: [comparison], confirmed: [] } };
  const page = renderHook(() => useAttributeActivities());
  await waitFor(() => expect(page.result.current.activities).toHaveLength(1));
  await act(async () => page.result.current.confirm([], 'vote-1'));
  expect(cache?.cachedAt).toBe(0);
  expect(page.result.current.activities).toHaveLength(1);
});
