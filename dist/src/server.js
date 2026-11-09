import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { executeSearch } from './search.js';
export const server = new McpServer({
    name: 'x-search-mcp',
    version: '0.1.0',
});
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
    auth_mode: z
        .enum(['auto', 'api_key', 'oauth'])
        .optional()
        .describe('Credential selection mode: auto, api_key, or oauth'),
};
const toolDefinition = {
    description: 'Search X (formerly Twitter) using xAI responses API with real-time index, account filters, and date ranges. Each call saves a local log of the raw upstream response; the path is returned as log_file.',
    inputSchema: searchInputSchema,
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    },
};
const toolHandler = async (params, extra) => {
    try {
        const signal = extra?.signal;
        const result = await executeSearch(params, { signal });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                },
            ],
            structuredContent: result,
        };
    }
    catch (err) {
        const errorPayload = {
            success: false,
            provider: 'xai',
            tool: 'x_search',
            log_file: err.logFile || null,
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
                    type: 'text',
                    text: JSON.stringify(errorPayload, null, 2),
                },
            ],
            structuredContent: errorPayload,
        };
    }
};
if (typeof server.registerTool === 'function') {
    server.registerTool('x_search', toolDefinition, toolHandler);
}
else if (typeof server.tool === 'function') {
    server.tool('x_search', toolDefinition.description, toolDefinition.inputSchema, toolDefinition.annotations, toolHandler);
}
/**
 * Launch stdio server.
 * stdout is strictly reserved for JSON-RPC MCP messages.
 * Diagnostic logs are written to stderr.
 */
export function startStdio() {
    return serveStdio(() => server);
}
//# sourceMappingURL=server.js.map