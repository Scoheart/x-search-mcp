import { McpServer } from '@modelcontextprotocol/server';
export declare function createServer(): McpServer;
/** @deprecated Create a fresh server with createServer() for each transport. */
export declare const server: McpServer;
/**
 * Launch stdio server.
 * stdout is strictly reserved for JSON-RPC MCP messages.
 * Diagnostic logs are written to stderr.
 */
export declare function startStdio(): import("@modelcontextprotocol/server/stdio").StdioServerHandle;
//# sourceMappingURL=server.d.ts.map