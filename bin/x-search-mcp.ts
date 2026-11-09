#!/usr/bin/env node
import { runCli } from '../src/cli.js';

runCli().catch((err) => {
  console.error('Fatal x-search-mcp error:', err);
  process.exit(1);
});
