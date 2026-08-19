import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateBackOr } from './inAppBack';

describe('navigateBackOr', () => {
  beforeEach(() => {
    window.history.replaceState({ idx: 0 }, '', '/add');
  });

  it('uses the in-app history entry when available', () => {
    window.history.replaceState({ idx: 2 }, '', '/add');
    const navigate = vi.fn();
    navigateBackOr(navigate, '/');
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('uses the parent route for a direct entry', () => {
    const navigate = vi.fn();
    navigateBackOr(navigate, '/games/test-game');
    expect(navigate).toHaveBeenCalledWith('/games/test-game', { replace: true });
  });
});
