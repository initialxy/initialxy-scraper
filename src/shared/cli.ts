import path from 'node:path';
import type { CLIArgs } from './types.ts';

/**
 * Parse CLI arguments
 */
export function parseCLIArgs(): CLIArgs {
  const args: CLIArgs = {};

  // --output / -o
  const outputMatch =
    process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-o' || arg.startsWith('-o='))?.split('=')[1];
  if (outputMatch) {
    args.outputDir = path.resolve(process.cwd(), outputMatch);
  }

  // --url / -u
  const urlMatch =
    process.argv.find((arg) => arg.startsWith('--url='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-u' || arg.startsWith('-u='))?.split('=')[1];
  if (urlMatch) {
    args.url = urlMatch;
  }

  // --filter / -f
  const filterMatch =
    process.argv.find((arg) => arg.startsWith('--filter='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-f' || arg.startsWith('-f='))?.split('=')[1];
  if (filterMatch) {
    args.filter = new RegExp(filterMatch);
  }

  // --selector / -s
  const selectorMatch =
    process.argv.find((arg) => arg.startsWith('--selector='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-s' || arg.startsWith('-s='))?.split('=')[1];
  if (selectorMatch) {
    args.selector = selectorMatch;
  }

  // --wait / -w
  const waitMatch =
    process.argv.find((arg) => arg.startsWith('--wait='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-w' || arg.startsWith('-w='))?.split('=')[1];
  if (waitMatch) {
    args.wait = parseFloat(waitMatch);
  }

  // --scroll / -r
  const scrollMatch =
    process.argv.find((arg) => arg.startsWith('--scroll='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-r' || arg.startsWith('-r='))?.split('=')[1];
  if (scrollMatch) {
    args.scroll = parseFloat(scrollMatch);
  }

  // --close-on-idle / -c
  const closeOnIdleMatch =
    process.argv.find((arg) => arg.startsWith('--close-on-idle='))?.split('=')[1] ||
    process.argv.find((arg) => arg === '-c' || arg.startsWith('-c='))?.split('=')[1];
  if (closeOnIdleMatch) {
    args.closeOnIdle = parseFloat(closeOnIdleMatch);
  }

  // --rename-sequence
  const renameSequenceMatch = process.argv
    .find((arg) => arg.startsWith('--rename-sequence='))
    ?.split('=')[1];
  if (renameSequenceMatch) {
    args.renameSequence = renameSequenceMatch;
  }

  return args;
}
