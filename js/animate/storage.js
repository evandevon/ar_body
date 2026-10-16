// Keeps students' characters on this device (IndexedDB), so they can come back to them.
// Nothing is uploaded anywhere.
const DB = 'ar-body', STORE = 'characters';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { resolve(req?.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
};

export const saveCharacter = c => tx('readwrite', s => s.put({ ...c, updated: Date.now() }));
export const deleteCharacter = id => tx('readwrite', s => s.delete(id));
export const getCharacter = id => tx('readonly', s => s.get(id));
export async function listCharacters() {
  const all = (await tx('readonly', s => s.getAll())) ?? [];
  return all.sort((a, b) => b.updated - a.updated);
}
