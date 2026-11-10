// One JSON-answering chat call to OpenRouter, sent through the Rust proxy
// (ai_request), which attaches the key and fixes the URL. Ported from the web
// app's lib/openrouter/chat.ts: same request body, same error wording.

import { z } from 'zod';

import { aiRequest } from '@/lib/app/native';
import type { AiUsage } from './types';

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Set when the model answered — and billed — but the answer was unusable. */
    readonly usage: AiUsage | null = null,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatJsonRequest = {
  model: string;
  system: string;
  user: ChatPart[];
  maxTokens: number;
  schema: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
};

export type ChatJsonResult = { json: unknown; model: string; usage: AiUsage | null };

const usageSchema = z.object({
  prompt_tokens: z.number().finite().nonnegative().optional(),
  completion_tokens: z.number().finite().nonnegative().optional(),
  cost: z.number().finite().nonnegative().optional(),
  is_byok: z.boolean().optional(),
});

/** Pull the JSON out of a model reply, fenced or with a leading sentence. */
export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to the outermost brackets */
  }
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start === -1 || end <= start) throw new AiError('The model did not return usable JSON.', 502);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiError('The model did not return usable JSON.', 502);
  }
}

export async function chatJson(req: ChatJsonRequest): Promise<ChatJsonResult> {
  let res;
  try {
    res = await aiRequest('chat', {
      model: req.model,
      usage: { include: true },
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens,
      ...(req.reasoningEffort && { reasoning: { effort: req.reasoningEffort, exclude: true } }),
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema },
      },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    });
  } catch (err) {
    throw new AiError(err instanceof Error ? err.message : 'Could not reach OpenRouter.', 504);
  }

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 401 || res.status === 403) {
      throw new AiError('OpenRouter rejected the key. Check it in Settings, or add a new one.', 502);
    }
    if (res.status === 402) throw new AiError('The OpenRouter account is out of credit.', 402);
    throw new AiError(
      res.status === 429
        ? 'The model is rate limited right now. Try again in a moment.'
        : 'The model could not be reached.',
      res.status === 429 ? 429 : 502,
    );
  }

  let payload: {
    choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    model?: string;
    usage?: unknown;
  } | null = null;
  try {
    payload = JSON.parse(res.body);
  } catch {
    payload = null;
  }

  const parsedUsage = usageSchema.safeParse(payload?.usage);
  const usage: AiUsage | null = parsedUsage.success
    ? {
        promptTokens: parsedUsage.data.prompt_tokens ?? null,
        completionTokens: parsedUsage.data.completion_tokens ?? null,
        costUsd: parsedUsage.data.cost ?? null,
        isByok: parsedUsage.data.is_byok ?? null,
      }
    : null;

  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === 'length') {
    throw new AiError('The answer ran past its length limit. Try less material at once, or fewer cards.', 422, usage);
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AiError('The model returned an empty answer.', 502, usage);
  }
  let json: unknown;
  try {
    json = extractJson(content);
  } catch (err) {
    throw new AiError(err instanceof Error ? err.message : 'Unusable answer.', 502, usage);
  }
  return { json, model: typeof payload?.model === 'string' ? payload.model : req.model, usage };
}
