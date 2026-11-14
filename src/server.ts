import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { executeSearch } from './search.js';
import type { XSearchInput } from './types.js';
import { version } from './version.js';

const searchInputSchema = {
  query: z
    .string()
    .describe('Search query text, maximum 16000 characters'),
  allowed_x_handles: z
    .array(z.string())
    .max(10)
    .optional()
    .describe('Allowed X handles (max 10, without @), mutually exclusive with excluded_x_handles'),
  excluded_x_handles: z
    .array(z.string())
    .max(10)
    .optional()
    .describe('Excluded X handles (max 10, without @), mutually exclusive with allowed_x_handles'),
  from_date: z
    .string()
    .optional()
    .describe('Start date (YYYY-MM-DD), inclusive, real calendar date'),
  to_date: z
    .string()
    .optional()
    .describe('End date (YYYY-MM-DD), exclusive, real calendar date strictly later than from_date'),
  enable_image_understanding: z
    .boolean()
    .optional()
    .describe('Enable image understanding for image-containing posts'),
  enable_video_understanding: z
    .boolean()
    .optional()
    .describe('Enable video understanding for video-containing posts'),
};

const toolDefinition = {
  description: 'Search X (formerly Twitter) using the xAI Responses API with account filters and date ranges.',
  inputSchema: searchInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

type SearchHandler = (params: XSearchInput, context: ServerContext) => ReturnType<typeof executeSearch>;

const toolHandler = async (search: SearchHandler, params: XSearchInput, context: ServerContext, settingsUrl?: string) => {
  try {
    const result = await search(params, context);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err: any) {
    const errorPayload = {
      success: false,
      provider: 'xai',
      tool: 'x_search',
      log_file: err.logFile || null,
      ...(settingsUrl && (err.code === 'XAI_KEY_REQUIRED' || err.code === 'UPSTREAM_AUTH_ERROR')
        ? { settings_url: settingsUrl } : {}),
      error: {
        code: err.code || 'SEARCH_ERROR',
        message: err.message || 'Search execution failed',
        status: err.status || null,
      },
    };

    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(errorPayload, null, 2),
        },
      ],
      structuredContent: errorPayload,
    };
  }
};

export function createServer(): McpServer {
  return createSearchServer((params, context) => executeSearch(params, { signal: context.mcpReq.signal }));
}

export function createSearchServer(search: SearchHandler, settingsUrl?: string): McpServer {
  const instance = new McpServer({ name: 'x-search-mcp', version });
  const active = new Set<ReturnType<typeof toolHandler>>();
  let closing: Promise<void> | undefined;
  const definition = settingsUrl ? toolDefinition : {
    ...toolDefinition,
    description: 'Search X (formerly Twitter) using xAI responses API with real-time index, account filters, and date ranges. Each call saves a local log of the raw upstream response; the path is returned as log_file.',
    inputSchema: {
      ...searchInputSchema,
      auth_mode: z.enum(['auto', 'api_key', 'oauth']).optional()
        .describe('Credential selection mode: auto, api_key, or oauth'),
    },
  };
  instance.registerTool('x_search', definition, (params, context) => {
    if (closing) throw new Error('MCP server is closing');
    const task = toolHandler(search, params, context, settingsUrl);
    active.add(task);
    void task.then(() => { active.delete(task); }, () => { active.delete(task); });
    return task;
  });
  // The modern SDK closes the underlying Server directly; legacy code closes
  // McpServer. Owning the underlying close covers both entry points.
  const closeTransport = instance.server.close.bind(instance.server);
  instance.server.close = () => {
    closing ??= Promise.resolve().then(async () => {
      await closeTransport();
      // Cancel queued/search work, but finish any already accepted credential rotation.
      await Promise.allSettled([...active]);
    });
    return closing;
  };
  return instance;
}

/** @deprecated Create a fresh server with createServer() for each transport. */
export const server = createServer();

/**
 * Launch stdio server.
 * stdout is strictly reserved for JSON-RPC MCP messages.
 * Diagnostic logs are written to stderr.
 */
export function startStdio() {
  return serveStdio(createServer);
}
