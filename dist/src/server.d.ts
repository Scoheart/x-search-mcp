import { McpServer } from '@modelcontextprotocol/server';
export declare const server: McpServer;
/**
 * Launch stdio server.
 * stdout is strictly reserved for JSON-RPC MCP messages.
 * Diagnostic logs are written to stderr.
 */
export declare function startStdio(): import("@modelcontextprotocol/server/stdio").StdioServerHandle;
//# sourceMappingURL=server.d.ts.map