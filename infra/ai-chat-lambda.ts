/**
 * AWS Lambda — Pebble Decision Diamond AI proxy.
 *
 * Receives the same ChatRequest envelope the frontend stub backend
 * understands, forwards it to Anthropic, streams the SSE response back
 * verbatim. No translation — the wire format is the same on both sides.
 *
 * ┌──────────┐   POST /     ┌────────────────────┐   POST /v1/messages
 * │  Vue app │ ───────────▶ │  Lambda (this code)│ ──────────────────▶
 * │          │              │  ANTHROPIC_API_KEY │       Anthropic
 * │          │ ◀─SSE stream─│  in env, never out │ ◀──SSE stream───────
 * └──────────┘              └────────────────────┘
 *
 * --------------------------------------------------------------------
 * Deploy
 * --------------------------------------------------------------------
 *
 * 1. From repo root:
 *      cd infra
 *      npm init -y
 *      npm install @anthropic-ai/sdk@^0.30
 *      npm install -D @types/aws-lambda esbuild
 *
 * 2. Bundle to a single file (Lambda doesn't run TS directly):
 *      npx esbuild ai-chat-lambda.ts \
 *        --bundle --platform=node --target=node20 \
 *        --outfile=dist/index.js --format=cjs
 *      cd dist && zip -r ../lambda.zip .
 *
 * 3. Create the function (Console or CLI):
 *      aws lambda create-function \
 *        --function-name pebble-ai-chat \
 *        --runtime nodejs20.x \
 *        --role <arn-of-execution-role> \
 *        --handler index.handler \
 *        --zip-file fileb://lambda.zip \
 *        --environment 'Variables={ANTHROPIC_API_KEY=sk-ant-...,ALLOWED_ORIGIN=https://your-app.example.com}'
 *
 * 4. Create a Function URL with response streaming enabled:
 *      aws lambda create-function-url-config \
 *        --function-name pebble-ai-chat \
 *        --auth-type NONE \
 *        --invoke-mode RESPONSE_STREAM \
 *        --cors 'AllowOrigins=https://your-app.example.com,AllowMethods=POST,AllowHeaders=content-type'
 *
 *    The URL it prints back is what you put in VITE_AI_API_URL on the
 *    frontend. SPA call → Lambda → Anthropic → SSE back.
 *
 * 5. Tighten before production:
 *      - Add `auth-type=AWS_IAM` and sign requests from your app's
 *        backend (or put API Gateway + Cognito in front).
 *      - Add concurrency limits and an alarm on cost.
 *      - Log only request IDs, never prompt content or completions.
 *
 * --------------------------------------------------------------------
 * Wire-format compatibility note
 * --------------------------------------------------------------------
 * The frontend's `ChatRequest` (see src/lib/ai/aiTypes.ts) is the same
 * shape Anthropic's `client.messages.create()` accepts, minus the
 * `model` validation. We forward the body almost verbatim — the only
 * normalization is dropping any client-supplied `stream` flag (we
 * always stream here) and pinning `max_tokens` to a server-side ceiling
 * so a malicious client can't ask for 200K tokens.
 */

// NOTE: this file isn't part of the Vite build. It's deployed
// separately to Lambda. Keep its imports isolated from src/.

import type { Handler, APIGatewayProxyEventV2 } from 'aws-lambda';
import Anthropic from '@anthropic-ai/sdk';

// AWS Lambda response-streaming helper. Declared globally on Node20
// runtimes — not in @types/aws-lambda yet, so type it minimally.
declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: APIGatewayProxyEventV2,
      responseStream: NodeJS.WritableStream & {
        setContentType: (type: string) => void;
        end: () => void;
      },
    ) => Promise<void>,
  ) => Handler;
  HttpResponseStream: {
    from: (
      stream: NodeJS.WritableStream,
      metadata: { statusCode: number; headers?: Record<string, string> },
    ) => NodeJS.WritableStream;
  };
};

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

// Hard caps so a client can't run up the bill.
const MAX_TOKENS_CEILING = 2048;
const MAX_MESSAGES = 40; // last N turns; trim older
const MAX_PROMPT_CHARS = 20_000;

const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  // CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    const stream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 204,
      headers: corsHeaders(),
    });
    stream.end();
    return;
  }

  if (event.requestContext.http.method !== 'POST') {
    return writeJson(responseStream, 405, { error: 'Method not allowed' });
  }

  if (!ANTHROPIC_API_KEY) {
    return writeJson(responseStream, 500, { error: 'Server misconfigured: ANTHROPIC_API_KEY missing' });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return writeJson(responseStream, 400, { error: 'Invalid JSON body' });
  }

  // Server-side validation
  const model = String(body.model ?? 'claude-sonnet-4-5');
  if (!ALLOWED_MODELS.has(model)) {
    return writeJson(responseStream, 400, { error: `Model not allowed: ${model}` });
  }

  const maxTokens = Math.min(
    Number(body.max_tokens ?? MAX_TOKENS_CEILING),
    MAX_TOKENS_CEILING,
  );

  const messagesRaw = Array.isArray(body.messages) ? body.messages : [];
  const messages = messagesRaw.slice(-MAX_MESSAGES);
  const promptSize = JSON.stringify(messages).length;
  if (promptSize > MAX_PROMPT_CHARS) {
    return writeJson(responseStream, 413, { error: 'Conversation too large' });
  }

  // The frontend sends system + tools in the canonical Anthropic shape.
  // We forward them verbatim — including any cache_control breakpoints.
  const system = Array.isArray(body.system) ? body.system : undefined;
  const tools = Array.isArray(body.tools) ? body.tools : undefined;

  // Open SSE response
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      ...corsHeaders(),
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });

  try {
    // Use the SDK's streaming helper — yields parsed events we can
    // re-emit as SSE.
    const upstream = client.messages.stream({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      max_tokens: maxTokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      system: system as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
    });

    for await (const event of upstream) {
      // Forward every event verbatim — same shape the frontend stub
      // emits, so the client doesn't care which backend it's talking to.
      stream.write(`event: ${event.type}\n`);
      stream.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // Final message is automatically constructed by the SDK; if we
    // wanted usage stats for logging we'd await `upstream.finalMessage()`
    // here. The events stream already carries `message_delta.usage` so
    // the client has what it needs.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Emit an Anthropic-shape error event so the client's SSE parser
    // can pick it up cleanly.
    stream.write(`event: error\n`);
    stream.write(
      `data: ${JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message },
      })}\n\n`,
    );
  } finally {
    stream.end();
  }
});

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

function writeJson(
  responseStream: NodeJS.WritableStream & { setContentType?: (t: string) => void; end: () => void },
  statusCode: number,
  body: unknown,
) {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { ...corsHeaders(), 'content-type': 'application/json' },
  });
  stream.write(JSON.stringify(body));
  stream.end();
}
