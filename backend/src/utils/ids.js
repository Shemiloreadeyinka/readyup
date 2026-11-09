import { randomUUID } from 'node:crypto';

export const newId = (prefix) => (prefix ? `${prefix}_${randomUUID()}` : randomUUID());

export const nowIso = () => new Date().toISOString();
