// ai.rs for the web version: the user's OpenRouter key, kept in this
// browser's IndexedDB, and the same closed list of endpoints it may be sent
// to. The browser calls openrouter.ai directly; nothing goes through a server.

import { idbGet, idbPut } from './idb';
import { validModel } from './settings';

const ORIGIN = 'https://openrouter.ai/api/v1';
const KEY = 'openrouter-key';
const MAX_BODY = 24 * 1024 * 1024;

export type KeyStatus = { present: boolean; hint: string | null };
export type Reply = { status: number; body: string };

const validKey = (key: string) => key.length >= 20 && key.length <= 300 && /^[\x21-\x7e]+$/.test(key);
const hint = (key: string) => `…${key.slice(-4)}`;

async function readKey(): Promise<string | null> {
  const key = await idbGet<string>(KEY);
  return typeof key === 'string' && validKey(key) ? key : null;
}

export async function keyStatus(): Promise<KeyStatus> {
  const key = await readKey();
  return key ? { present: true, hint: hint(key) } : { present: false, hint: null };
}

export async function setKey(raw: string): Promise<KeyStatus> {
  const key = raw.trim();
  if (!validKey(key)) throw 'That does not look like an OpenRouter key.';
  await idbPut({ [KEY]: key });
  return keyStatus();
}

export async function clearKey(): Promise<KeyStatus> {
  await idbPut({ [KEY]: undefined });
  return { present: false, hint: null };
}

function checkChatBody(body: unknown, size: number): void {
  if (size > MAX_BODY) throw 'That request is too large.';
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw 'The request must be a JSON object.';
  const b = body as Record<string, unknown>;
  if (typeof b.model !== 'string') throw 'The request names no model.';
  if (!validModel(b.model)) throw 'That model name is not valid.';
  if (!Array.isArray(b.messages)) throw 'The request has no messages.';
  if (b.stream === true) throw 'Streaming is not supported.';
}

export async function request(endpoint: string, body: unknown): Promise<Reply> {
  const key = await readKey();
  if (!key) throw 'No OpenRouter key yet. Add one in Settings.';
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'X-Title': 'Flashcards web' };
  let url: string;
  let init: RequestInit;
  if (endpoint === 'chat') {
    if (body == null) throw 'No request body.';
    const raw = JSON.stringify(body);
    checkChatBody(body, raw.length);
    url = `${ORIGIN}/chat/completions`;
    init = { method: 'POST', body: raw, headers: { ...headers, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90_000) };
  } else if (endpoint === 'key' || endpoint === 'credits') {
    url = `${ORIGIN}/${endpoint === 'key' ? 'auth/key' : 'credits'}`;
    init = { method: 'GET', headers, signal: AbortSignal.timeout(10_000) };
  } else {
    throw 'Unknown endpoint';
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (err) {
    throw err instanceof DOMException && err.name === 'TimeoutError'
      ? 'The model took too long to answer.'
      : 'Could not reach OpenRouter.';
  }
  try {
    return { status: res.status, body: await res.text() };
  } catch {
    throw "Could not read OpenRouter's answer.";
  }
}
