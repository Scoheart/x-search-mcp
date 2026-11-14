import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { executeSearch } from './search.js';
import type { XSearchInput } from './types.js';
type SearchHandler = (params: XSearchInput, context: ServerContext) => ReturnType<typeof executeSearch>;
export declare function createServer(): McpServer;
export declare function createSearchServer(search: SearchHandler, settingsUrl?: string): McpServer;
/** @deprecated Create a fresh server with createServer() for each transport. */
export declare const server: McpServer;
/**
 * Launch stdio server.
 * stdout is strictly reserved for JSON-RPC MCP messages.
 * Diagnostic logs are written to stderr.
 */
export declare function startStdio(): import("@modelcontextprotocol/server/stdio").StdioServerHandle;
export {};
//# sourceMappingURL=server.d.ts.map