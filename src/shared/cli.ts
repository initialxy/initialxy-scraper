import { app } from 'electron';
import { Command } from 'commander';
import path from 'node:path';
import type { CLIArgs } from './types.ts';
import { EXIT_CODES } from './constants.ts';

/**
 * Parse CLI arguments using commander
 */
export function parseCLIArgs(): CLIArgs {
  const program = new Command();

  program
    .name(app.getName())
    .description('GUI browser with scraping capabilities')
    .version(app.getVersion())
    .argument('<url>', 'URL to load (required)')
    .option('-o, --output-dir <dir>', 'Output directory for scraped files')
    .option('-f, --filter <regex>', 'URL filter regex for selecting responses')
    .option('-s, --selector <selector>', 'CSS selector for src attribute extraction')
    .option(
      '-w, --wait <seconds>',
      'Wait seconds after page load before closing (starts idle timer if --close-on-idle is also set)'
    )
    .option('-r, --scroll <pixels>', 'Scroll down by pixels (0 = scroll to bottom)')
    .option('-c, --close-on-idle <seconds>', 'Close window after N seconds of network idle')
    .option(
      '--rename-sequence <digits>',
      'Rename files to sequential numbers with specified zero-padding (e.g., 4 for 0001, 0002, etc.)'
    )
    .option('-v, --verbose', 'Enable verbose logging for network traffic')
    .option('--output-curl', 'Output curl commands for matching URLs to stdout')
    .option('--flat-dir', 'Dump files flat in output-dir without subdirectories')
    .option('-W, --width <pixels>', 'Initial window width')
    .option('-H, --height <pixels>', 'Initial window height');

  program.parse();

  const args = program.args;
  const options = program.opts();

  if (args.length === 0) {
    console.error('Error: URL argument is required');
    program.outputHelp();
    process.exit(EXIT_CODES.invalidCommandLineArgs);
  }

  let url = args[0];

  // Prefix with https:// if no protocol specified
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  const result: CLIArgs = {
    url,
  };

  if (options.outputDir) {
    result.outputDir = path.resolve(process.cwd(), options.outputDir);
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

  if (options.verbose) {
    result.verbose = true;
  }

  if (options.outputCurl) {
    result.outputCurl = true;
  }

  if (options.flatDir) {
    result.flatDir = true;
  }

  if (options.width) {
    result.width = parseInt(options.width, 10);
  }

  if (options.height) {
    result.height = parseInt(options.height, 10);
  }

  return result;
}
