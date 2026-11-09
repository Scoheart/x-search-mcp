#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(__dirname, '../dist/src/cli.js');
const srcCli = path.resolve(__dirname, '../src/cli.js');
const srcTsCli = path.resolve(__dirname, '../src/cli.ts');

async function main() {
  let cliModule;
  if (fs.existsSync(distCli)) {
    cliModule = await import(distCli);
  } else if (fs.existsSync(srcCli)) {
    cliModule = await import(srcCli);
  } else if (fs.existsSync(srcTsCli)) {
    cliModule = await import(srcTsCli);
  } else {
    throw new Error('Could not locate CLI entry point in dist/ or src/');
  }

  await cliModule.runCli();
}

main().catch((err) => {
  console.error('Fatal x-search-mcp error:', err);
  process.exit(1);
});
