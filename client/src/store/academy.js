import { create } from 'zustand';

const STORAGE_KEY = 'academy-manager:academyId';

function readStoredId() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort only — a private window or blocked storage shouldn't break the app
  }
}

/**
 * Which academy (tenant) the app is currently operating as. Every API call
 * sends this as the `X-Academy-Id` header (see api/client.js) so the
 * backend can scope — and reject cross-tenant access to — every query.
 */
export const useAcademyStore = create((set) => ({
  academyId: readStoredId(),
  academyName: '',
  role: '',
  setAcademy: (academy) => {
    writeStoredId(academy ? String(academy.ROWID) : null);
    set({
      academyId: academy ? String(academy.ROWID) : null,
      academyName: academy ? academy.Name : '',
      role: academy ? academy.role : '',
    });
  },
}));
