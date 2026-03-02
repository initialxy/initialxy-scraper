import path from 'node:path';
import { Command } from 'commander';
import type { CLIArgs } from './types.ts';

/**
 * Parse CLI arguments using commander
 */
export function parseCLIArgs(): CLIArgs {
  const program = new Command();

  program
    .name('initialxy-scraper')
    .description('GUI browser with scraping capabilities')
    .version('1.0.0')
    .argument('<url>', 'URL to load (required)')
    .option('-o, --output <dir>', 'Output directory for scraped files')
    .option('-f, --filter <regex>', 'URL filter regex for eligible responses')
    .option('-s, --selector <selector>', 'CSS selector for src attribute extraction')
    .option('-w, --wait <seconds>', 'Wait seconds after page load before closing')
    .option('-r, --scroll <pixels>', 'Scroll down by pixels (0 = scroll to bottom)')
    .option('-c, --close-on-idle <seconds>', 'Close window after N seconds of network idle')
    .option('--rename-sequence <pattern>', 'Rename pattern for scraped files');

  program.parse();

  const args = program.args;
  const options = program.opts();

  if (args.length === 0) {
    console.error('Error: URL argument is required');
    program.outputHelp();
    process.exit(1);
  }

  const result: CLIArgs = {
    url: args[0],
  };

  if (options.output) {
    result.outputDir = path.resolve(process.cwd(), options.output);
  }

  if (options.filter) {
    result.filter = new RegExp(options.filter);
  }

  if (options.selector) {
    result.selector = options.selector;
  }

  if (options.wait) {
    result.wait = parseFloat(options.wait);
  }

  if (options.scroll) {
    result.scroll = parseFloat(options.scroll);
  }

  if (options.closeOnIdle) {
    result.closeOnIdle = parseFloat(options.closeOnIdle);
  }

  if (options.renameSequence) {
    result.renameSequence = options.renameSequence;
  }

  return result;
}
