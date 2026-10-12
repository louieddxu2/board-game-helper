/** Same-route UI entries are coordinated before React Router sees a POP. */
const historyKey = '__boardGameHelperWorkspaceUi';
const sessionsKey = 'boardGameHelper.uiHistorySessions';
type Layer = { owner: string; depth: number };
type Marker = Layer & { session: string; baseIndex: number; stack: Layer[] };
type Owner = {
  count: number;
  dismiss(count: number): void;
  canDismiss(): boolean;
  mounted: boolean;
};
type Session = { id: string; baseIndex: number; destinationIndex?: number };

const indexOf = (state: unknown): number => {
  const index = state && typeof state === 'object' ? (state as { idx?: unknown }).idx : undefined;
  return typeof index === 'number' ? index : 0;
};
const markerOf = (state: unknown): Marker | undefined => {
  const marker = state && typeof state === 'object' ? (state as Record<string, unknown>)[historyKey] : undefined;
  if (!marker || typeof marker !== 'object') return undefined;
  const candidate = marker as Marker;
  return typeof candidate.session === 'string' && Number.isInteger(candidate.baseIndex)
    && Array.isArray(candidate.stack) && candidate.stack.length > 0
    && candidate.stack.every(layer => layer && typeof layer.owner === 'string' && Number.isInteger(layer.depth) && layer.depth > 0)
    && indexOf(state) === candidate.baseIndex + candidate.stack.length
    ? candidate : undefined;
};
const legacyDepthOf = (state: unknown): number => {
  const marker = state && typeof state === 'object' ? (state as Record<string, unknown>)[historyKey] : undefined;
  if (!marker || typeof marker !== 'object') return 0;
  const entry = marker as Partial<Marker>;
  return !entry.session && typeof entry.owner === 'string' && Number.isInteger(entry.depth) && entry.depth! > 0 ? entry.depth! : 0;
};
const equalLayer = (a: Layer, b: Layer) => a.owner === b.owner && a.depth === b.depth;

export class UiHistory {
  private owners = new Map<string, Owner>();
  private sessions = new Map<string, Session>();
  private session?: Session;
  private desired: Layer[] = [];
  private physical: Layer[] = [];
  private pending = false;
  private pendingRoutePop = false;
  private navigation?: () => void;
  private installed = false;
  private lastIndex = 0;
  private keyboardOpen = false;
  private keyboardUntil = 0;
  private keyboardCheck = () => false;
  private sequence = 0;

  install(keyboardCheck: () => boolean) {
    this.keyboardCheck = keyboardCheck;
    if (this.installed) return;
    this.installed = true;
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(sessionsKey) ?? '[]');
      if (Array.isArray(saved)) for (const session of saved) {
        if (session && typeof session.id === 'string' && Number.isInteger(session.baseIndex) && Number.isInteger(session.destinationIndex)) {
          this.sessions.set(session.id, session);
        }
      }
    } catch { /* Browsing with storage disabled still works within this document. */ }
    this.lastIndex = indexOf(window.history.state);
    window.addEventListener('popstate', this.pop, true);
    window.visualViewport?.addEventListener('resize', this.updateKeyboard);
    window.visualViewport?.addEventListener('scroll', this.updateKeyboard);
    window.addEventListener('resize', this.updateKeyboard);
    this.updateKeyboard();
    this.reconcile();
  }

  update(owner: string, count: number, dismiss: Owner['dismiss'], canDismiss: Owner['canDismiss']) {
    const previous = this.owners.get(owner);
    this.owners.set(owner, { count, dismiss, canDismiss, mounted: true });
    if (previous?.count === count) return;
    this.desired = this.desired.filter(layer => layer.owner !== owner || layer.depth <= count);
    const current = this.desired.filter(layer => layer.owner === owner).length;
    for (let depth = current + 1; depth <= count; depth++) this.desired.push({ owner, depth });
    this.reconcile();
  }

  unmount(owner: string) {
    const registration = this.owners.get(owner);
    if (!registration) return;
    registration.mounted = false;
    // StrictMode replays setup synchronously. Only a real unmount removes entries.
    queueMicrotask(() => {
      if (this.owners.get(owner)?.mounted) return;
      this.owners.delete(owner);
      this.desired = this.desired.filter(layer => layer.owner !== owner);
      this.reconcile();
    });
  }

  /** Collapse every UI layer before committing a new route to browser history. */
  navigate(action: () => void) {
    if (this.navigation) {
      this.navigation = action;
      return;
    }
    this.navigation = action;
    this.dismiss(this.desired);
    this.desired = [];
    this.keyboardOpen = false;
    this.keyboardUntil = 0;
    this.reconcile();
  }

  hasLayers() {
    return this.desired.length > 0 || this.physical.length > 0 || this.pending;
  }

  /** Called for normal Router navigation (including links outside a modal). */
  observeRoute() {
    const marker = markerOf(window.history.state);
    const index = indexOf(window.history.state);
    if (marker && marker.session === this.session?.id) return;
    if (this.physical.length || this.pending) {
      if (this.session) {
        this.session.destinationIndex = index;
        this.saveSessions();
      }
      if (this.pending) {
        // pushState can cancel queued traversals. The Router blocker normally
        // serializes navigation; this fallback also releases canceled work.
        this.pending = false;
        this.pendingRoutePop = false;
        this.navigation = undefined;
      }
      this.dismiss(this.desired);
      this.desired = [];
      this.physical = [];
      this.session = undefined;
    }
    this.lastIndex = index;
  }

  private updateKeyboard = () => {
    const open = this.keyboardCheck();
    if (open) this.keyboardUntil = 0;
    else if (this.keyboardOpen) this.keyboardUntil = Date.now() + 500;
    this.keyboardOpen = open;
  };

  private saveSessions() {
    try {
      // Store only history indices, never page content or user data. This lets
      // Forward skip obsolete UI even after reloading the destination page.
      window.sessionStorage.setItem(sessionsKey, JSON.stringify([...this.sessions.values()].filter(session => session.destinationIndex !== undefined)));
    } catch { /* Storage may be unavailable or full; in-memory navigation remains usable. */ }
  }

  private dismiss(layers: Layer[]) {
    const counts = new Map<string, number>();
    for (const layer of [...layers].reverse()) counts.set(layer.owner, (counts.get(layer.owner) ?? 0) + 1);
    for (const [owner, count] of counts) {
      const registration = this.owners.get(owner);
      if (!registration) continue;
      registration.count = Math.max(0, registration.count - count);
      registration.dismiss(count);
    }
  }

  private reconcile() {
    if (this.pending) return;
    const marker = markerOf(window.history.state);
    const legacyDepth = legacyDepthOf(window.history.state);
    if (legacyDepth) {
      this.pending = true;
      this.pendingRoutePop = true;
      window.history.go(-legacyDepth);
      return;
    }
    if (marker && marker.session !== this.session?.id) {
      // A closed UI's Forward entry (or an entry surviving a reload) is never
      // reused as a route. Return to its baseline before opening another UI.
      this.pending = true;
      this.pendingRoutePop = true;
      window.history.go(marker.baseIndex - indexOf(window.history.state));
      return;
    }
    let common = 0;
    while (common < this.physical.length && common < this.desired.length
      && equalLayer(this.physical[common], this.desired[common])) common++;
    if (common < this.physical.length) {
      this.pending = true;
      window.history.go(common - this.physical.length);
      return;
    }
    if (this.desired.length > common) {
      if (!this.session) {
        this.session = { id: `${Date.now()}-${++this.sequence}`, baseIndex: indexOf(window.history.state) };
        this.sessions.set(this.session.id, this.session);
      }
      for (const layer of this.desired.slice(common)) {
        this.physical.push(layer);
        const entry: Marker = { ...layer, session: this.session.id, baseIndex: this.session.baseIndex, stack: [...this.physical] };
        window.history.pushState({ ...window.history.state, idx: indexOf(window.history.state) + 1, [historyKey]: entry }, '');
      }
      this.lastIndex = indexOf(window.history.state);
    }
    if (!this.physical.length) {
      this.session = undefined;
      const navigation = this.navigation;
      this.navigation = undefined;
      navigation?.();
    }
  }

  private pop = (event: PopStateEvent) => {
    const marker = markerOf(event.state);
    const targetIndex = indexOf(event.state);
    const forward = targetIndex > this.lastIndex;
    this.lastIndex = targetIndex;
    if (this.pending) {
      const routePop = this.pendingRoutePop && !marker && !this.desired.length && !this.navigation;
      if (!routePop) event.stopImmediatePropagation();
      this.pending = false;
      this.pendingRoutePop = false;
      this.physical = marker && marker.session === this.session?.id ? [...marker.stack] : [];
      if (!this.physical.length) this.session = undefined;
      this.reconcile();
      return;
    }

    if (this.physical.length && this.session) {
      event.stopImmediatePropagation();
      const baseIndex = this.session.baseIndex;
      const target = marker?.session === this.session.id ? marker.stack : [];
      const removed = this.physical.slice(target.length);
      const top = this.owners.get(this.physical[this.physical.length - 1].owner);
      const keyboard = this.keyboardOpen || this.keyboardUntil > Date.now();
      this.physical = [...target];
      if (keyboard || top?.canDismiss() === false) {
        this.keyboardOpen = false;
        this.keyboardUntil = 0;
        if (targetIndex < baseIndex) {
          this.pending = true;
          window.history.go(baseIndex - targetIndex);
        } else this.reconcile();
        return;
      }
      this.desired = this.desired.filter(layer => !removed.some(candidate => equalLayer(layer, candidate)));
      this.dismiss(removed);
      // Browser go(-N) can traverse past the baseline. Consume UI first and
      // restore the baseline so closing dialogs never silently leaves a route.
      if (targetIndex < baseIndex) {
        this.pending = true;
        window.history.go(baseIndex - targetIndex);
      } else this.reconcile();
      return;
    }

    const legacyDepth = legacyDepthOf(event.state);
    if (legacyDepth) {
      event.stopImmediatePropagation();
      this.pending = true;
      this.pendingRoutePop = true;
      window.history.go(-legacyDepth);
    } else if (marker) {
      event.stopImmediatePropagation();
      const session = this.sessions.get(marker.session);
      const destination = forward ? session?.destinationIndex : undefined;
      this.pending = true;
      this.pendingRoutePop = true;
      window.history.go((destination ?? marker.baseIndex) - targetIndex);
    }
  };

  /** Isolated tests dispose their listeners after all real traversals settle. */
  dispose() {
    window.removeEventListener('popstate', this.pop, true);
    window.visualViewport?.removeEventListener('resize', this.updateKeyboard);
    window.visualViewport?.removeEventListener('scroll', this.updateKeyboard);
    window.removeEventListener('resize', this.updateKeyboard);
    this.installed = false;
    this.owners.clear();
    this.sessions.clear();
    this.session = undefined;
    this.desired = [];
    this.physical = [];
    this.pending = false;
    this.pendingRoutePop = false;
    this.navigation = undefined;
  }
}

export const uiHistory = new UiHistory();

if (import.meta.hot) import.meta.hot.dispose(() => uiHistory.dispose());
