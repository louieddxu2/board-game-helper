const STORAGE_KEY = 'board-game-helper.attribute-session';

const createSessionId = () => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `attr_${random.replace(/[^A-Za-z0-9_-]/g, '')}`;
};

export const getAttributeSessionId = () => {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[A-Za-z0-9:_-]{8,120}$/.test(existing)) return existing;
    const created = createSessionId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return createSessionId();
  }
};

export const createAttributeResponseId = () => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `attr_response_${random.replace(/[^A-Za-z0-9_-]/g, '')}`;
};
