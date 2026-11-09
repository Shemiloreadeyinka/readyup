import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';

/**
 * Minimal append-safe JSON collection store.
 * Deliberately file based: the first version must run with no database.
 */

const writeQueues = new Map();

const filePathFor = (collection) => path.join(config.paths.dataDir, `${collection}.json`);

const ensureDataDir = async () => {
  await fs.mkdir(config.paths.dataDir, { recursive: true });
};

/** Serialises writes per collection so concurrent requests cannot interleave. */
const enqueue = (collection, task) => {
  const previous = writeQueues.get(collection) ?? Promise.resolve();
  const next = previous.then(task, task);
  writeQueues.set(
    collection,
    next.catch(() => {}),
  );
  return next;
};

export async function readCollection(collection) {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePathFor(collection), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeCollection(collection, items) {
  await ensureDataDir();
  const target = filePathFor(collection);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(items, null, 2), 'utf8');
  await fs.rename(temp, target);
  return items;
}

/** Read-modify-write under the collection lock. */
export function mutateCollection(collection, mutator) {
  return enqueue(collection, async () => {
    const items = await readCollection(collection);
    const result = await mutator(items);
    await writeCollection(collection, Array.isArray(result) ? result : items);
    return result;
  });
}

export async function findById(collection, id) {
  const items = await readCollection(collection);
  return items.find((item) => item.id === id) ?? null;
}

export async function insert(collection, record) {
  await mutateCollection(collection, (items) => [...items, record]);
  return record;
}

export async function updateById(collection, id, patch) {
  let updated = null;
  await mutateCollection(collection, (items) =>
    items.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...patch, id: item.id, updatedAt: new Date().toISOString() };
      return updated;
    }),
  );
  return updated;
}

export async function removeById(collection, id) {
  let removed = false;
  await mutateCollection(collection, (items) =>
    items.filter((item) => {
      if (item.id === id) removed = true;
      return item.id !== id;
    }),
  );
  return removed;
}

/** Key/value document used for singleton records such as AI settings. */
export async function readDocument(name, fallback = {}) {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(filePathFor(name), 'utf8');
    return { ...fallback, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { ...fallback };
    throw error;
  }
}

export function writeDocument(name, value) {
  return enqueue(name, async () => {
    await ensureDataDir();
    const target = filePathFor(name);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temp, target);
    return value;
  });
}

export const COLLECTIONS = {
  cvs: 'cvs',
  tailored: 'tailored-cvs',
};
