#!/usr/bin/env node

// Track startup performance from the very beginning
const startupStart = performance.now();

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import process from 'process';
import chalk from 'chalk';
import { ConfigManager } from './config.js';
import type { CommitConfig } from './types/common.js';
import { CommitMessageSchema, CommitConfigSchema } from './schemas/validation.js';
import { ErrorType } from './types/error-handler.js';
import { withErrorHandling, SecureError } from './utils/error-handler.js';
import { PerformanceMonitor, withPerformanceTracking } from './utils/performance.js';
import { handleErrorImmediate } from './utils/process-utils.js';
import { PERFORMANCE_FLAGS } from './constants/performance.js';

// Log startup time
if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING) {
  process.nextTick(() => {
    const startupTime = performance.now() - startupStart;
    if (startupTime > 500) { // Only log if startup is slow
      console.log(`🚀 Startup time: ${startupTime.toFixed(2)}ms`);
    }
  });
}

// Type definitions for dynamic imports
type InquirerModule = typeof import('inquirer');
type GradientStringModule = typeof import('gradient-string');

let inquirerCache: InquirerModule | null = null;
let gradientStringCache: GradientStringModule | null = null;

const loadInquirer = async (): Promise<InquirerModule> => {
  inquirerCache ??= await import('inquirer');
  return inquirerCache;
};

const loadGradientString = async (): Promise<GradientStringModule> => {
  gradientStringCache ??= await import('gradient-string');
  return gradientStringCache;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const program = new Command();

// Helper function to parse configuration values
const parseConfigValue = (value: string): string | number | boolean => {
  const lowerValue = value.toLowerCase();

  switch (lowerValue) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      return !isNaN(Number(value)) ? Number(value) : value;
  }
};

program
  .name('cx')
  .description('🚀 AI-powered Git commit assistant')
  .version(packageJson.version);

// Main commit command
program
  .command('commit')
  .alias('c')
  .description(
    'Generate and create AI-powered commit messages'
  )
  .option(
    '-m, --message <message>',
    'Use provided commit message instead of generating one (uses traditional workflow)'
  )
  .option('-d, --dry-run', 'Show what would be committed without actually committing')
  .option('-i, --interactive', 'Use interactive mode (for traditional workflow only)')
  .option('--all', 'Stage all files and commit together (traditional workflow)')
  .option('--aggregate', 'Enable AI-powered commit aggregation (group related changes)')
  .option('--no-aggregate', 'Disable commit aggregation (commit files individually)')
  .action(
    async (options: {
      message?: string;
      dryRun?: boolean;
      interactive?: boolean;
      all?: boolean;
      aggregate?: boolean;
    }): Promise<void> => {
      return withErrorHandling(
        async (): Promise<void> => {
          // Validate command combinations
          if (options.interactive && !options.all) {
            console.error(chalk.red('❌ Error: --interactive option can only be used with --all flag'));
            console.log(`${chalk.yellow('\n💡 Correct usage:')}
${chalk.blue('  cx commit --all --interactive    # Interactive traditional workflow')}
${chalk.blue('  cx commit --all                  # Non-interactive traditional workflow')}
${chalk.blue('  cx commit                        # AI-powered grouping (default)')}
${chalk.blue('  cx commit --no-aggregate         # Individual commits without grouping')}
${chalk.blue('  cx commit --help                 # Show all options')}`);
            process.exit(1);
          }

          // Validate commit message if provided
          if (options.message) {
            const result = CommitMessageSchema.safeParse(options.message);
            if (!result.success) {
              throw new SecureError(
                `Invalid commit message: ${result.error.issues.map((e: { message: string }) => e.message).join(', ')}`,
                ErrorType.VALIDATION_ERROR,
                { operation: 'commit' },
                true
              );
            }
            options.message = result.data;
          }

          // Import only when needed to avoid loading heavy dependencies
          const operation = options.all ? 'commit-traditional' : 'commit-ai';

          await withPerformanceTracking(operation, async () => {
            const { CommitX } = await import('./core/commitx.js');
            const commitX = new CommitX();


            await commitX.commit({
              message: options.message,
              dryRun: options.dryRun,
              interactive: options.interactive,
              all: options.all,
            });
          });
        },
        { operation: 'commit' }
      );
    }
  );

// Status command
program
  .command('status')
  .alias('s')
  .description('Show repository status and changes')
  .action(async () => {
    return withErrorHandling(
      async (): Promise<void> => {
        // Import only when needed to avoid loading heavy dependencies
        const { CommitX } = await import('./core/commitx.js');
        const commitX = new CommitX();
        await commitX.status();
      },
      { operation: 'status' }
    );
  });

// Diff command
program
  .command('diff')
  .alias('d')
  .description('Show unstaged changes summary')
  .action(async () => {
    return withErrorHandling(
      async (): Promise<void> => {
        // Import only when needed to avoid loading heavy dependencies
        const { CommitX } = await import('./core/commitx.js');
        const commitX = new CommitX();
        await commitX.diff();
      },
      { operation: 'diff' }
    );
  });

// Configuration commands
const configCmd = program.command('config').description('Manage Commitron configuration');

configCmd
  .command('set <key> <value>')
  .description('Set configuration value')
  .action(async (key: string, value: string): Promise<void> => {
    await withErrorHandling(
      async (): Promise<void> => {
        // Validate that the key is a valid config key
        if (!(key in CommitConfigSchema.shape)) {
          throw new SecureError(
            `Invalid configuration key: ${key}. Allowed keys: ${Object.keys(CommitConfigSchema.shape).join(', ')}`,
            ErrorType.VALIDATION_ERROR,
            { operation: 'configSet', key },
            true
          );
        }

        const config = ConfigManager.getInstance();

        // Parse boolean values
        const parsedValue = parseConfigValue(value);

        await config.set(key as keyof CommitConfig, parsedValue);
        console.log(chalk.green(`✅ Set ${key} = ${parsedValue}`));
      },
      { operation: 'configSet', key }
    );
  });

configCmd
  .command('get [key]')
  .description('Get configuration value(s)')
  .action(async (key?: string): Promise<void> => {
    await withErrorHandling(
      async (): Promise<void> => {
        const config = ConfigManager.getInstance();
        const allKeys = Object.keys(CommitConfigSchema.shape);

        const isValidKey = (k: string): k is keyof CommitConfig => allKeys.includes(k);

        if (key) {
          if (!isValidKey(key)) {
            throw new SecureError(
              `Invalid configuration key: ${key}. Allowed keys: ${allKeys.join(', ')}`,
              ErrorType.VALIDATION_ERROR,
              { operation: 'configGet', key },
              true
            );
          }

          const value = key === 'apiKey' ? config.getApiKey() : config.get(key);
          console.log(`${key}: ${key === 'apiKey' && value ? '********' : value}`);
        } else {
          const allConfig = config.getConfig();
          const apiKey = config.getApiKey();

          console.log(chalk.blue('Current configuration:'));
          for (const [k, v] of Object.entries(allConfig)) {
            const isSensitive = k === 'apiKey';
            const displayValue = isSensitive ? '********' : v;
            console.log(`  ${k}: ${displayValue}`);
          }

          if (!('apiKey' in allConfig)) {
            console.log(`  apiKey: ${apiKey ? '********' : 'Not set'}`);
          }
        }
      },
      { operation: 'configGet', key }
    );
  });

configCmd
  .command('reset')
  .description('Reset configuration to defaults')
  .action(async () => {
    try {
      const inquirer = await loadInquirer();
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to reset all configuration to defaults?',
          default: false,
        },
      ]);

      if (confirm) {
        const config = ConfigManager.getInstance();
        config.reset();
        console.log(chalk.green('✅ Configuration reset to defaults'));
      } else {
        console.log(chalk.yellow('Reset cancelled'));
      }
    } catch (error) {
      handleErrorImmediate(error);
    }
  });

// Setup command for first-time configuration
program
  .command('setup')
  .description('Interactive setup for first-time users')
  .action(async () => {
    const inquirer = await loadInquirer();
    console.log(chalk.blue('🚀 Welcome to Commitron Setup!\n'));

    try {
      const config = ConfigManager.getInstance();

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'Enter your Gemini AI API key:',
          validate: (input: string): string | boolean => {
            if (!input.trim()) {
              return 'API key is required. Get one from https://makersuite.google.com/app/apikey';
            }
            return true;
          },
        },
      ]);

      await config.saveConfig(answers);

      console.log(`${chalk.green('\n✅ Setup completed successfully!')}
${chalk.blue('You can now use "cx" to start making AI-powered commits.')}
${chalk.gray('Use "cx config" to modify settings later.')}`);
    } catch (error) {
      handleErrorImmediate(error, 'Setup failed');
    }
  });

// Privacy command
program
  .command('privacy')
  .description('Show privacy settings and data handling information')
  .action(async (): Promise<void> => {
    console.log(`${chalk.blue('🔒 Commitron Privacy Information:\n')}

${chalk.yellow('Data Sent to AI:')}
  • File paths (sanitized to remove usernames)
  • Code changes (up to 3000 characters per file)
  • File metadata (additions/deletions counts)
  • File status (new/modified/deleted/renamed)

${chalk.yellow('Data NOT Sent to AI:')}
  • API keys or authentication tokens
  • Personal information (names, emails)
  • System information (OS, hardware)
  • Repository metadata (URLs, branch names)

${chalk.yellow('Privacy Protections:')}
  • Sensitive files are automatically skipped
  • File paths are sanitized to remove usernames
  • Potential secrets are redacted from content
  • Content is limited to 3000 characters per file
  • Total request size is capped at 100KB

${chalk.yellow('Sensitive File Types (Auto-skipped):')}
  • .env, .key, .pem, .p12, .pfx, .p8 files
  • Files in secrets/, keys/, credentials/ directories
  • Files containing API keys, passwords, or tokens

${chalk.yellow('Common Warning Types:')}
  • Potential sensitive data detected
  • Sensitive file pattern detected
  • Potential secrets detected in comments
  • Sensitive file type
  • Located in sensitive directory

${chalk.gray('For more information, visit: https://github.com/sojanvarghese/commitx#privacy')}`);
  });

// Help command with examples
program
  .command('help-examples')
  .description('Show usage examples')
  .action(async (): Promise<void> => {
    const { pastel } = await loadGradientString();
    console.log(`${pastel('📚 Commitron Usage Examples:\n')}

${chalk.yellow('Basic usage:')}
  cx                             # Process files with AI
  cx commit --dry-run            # Preview commits
  cx commit                      # Direct CLI access

${chalk.yellow('Traditional workflow:')}
  cx commit --all                # Stage all files and commit together
  cx commit -m "fix: bug"        # Use custom message (traditional)

${chalk.yellow('Status and information:')}
  cx status                      # Show repository status
  cx diff                        # Show changes summary

${chalk.yellow('Configuration:')}
  cx setup                       # Interactive setup
  cx config                      # View configuration
  cx config set <key> <value>    # Set configuration values
  cx config reset                # Reset configuration
  cx privacy                     # Show privacy information`);
  });

// Debug command
program
  .command('debug')
  .description('Debug Git repository detection and environment')
  .action(async (): Promise<void> => {
    let debugOutput = `${chalk.blue('\n🔍 Commitron Debug Information:\n')}

${chalk.gray('Environment:')}
  Current working directory: ${process.cwd()}
  Node.js version: ${process.version}
  Platform: ${process.platform}
  Architecture: ${process.arch}

${chalk.gray('\nGit repository detection:')}`;

    try {
      const { validateGitRepository } = await import('./utils/security.js');
      const validation = await validateGitRepository(process.cwd());
      debugOutput += `\n  Valid Git repository: ${validation.isValid ? '✅ Yes' : '❌ No'}`;
      if (!validation.isValid) {
        debugOutput += `\n  Error: ${validation.error}`;
      } else {
        debugOutput += `\n  Repository path: ${validation.sanitizedValue}`;
      }
    } catch (error) {
      debugOutput += `\n  Error during validation: ${error}`;
    }

    debugOutput += `\n\n${chalk.gray('Git directory structure:')}`;
    try {
      const fs = await import('fs');
      const path = await import('path');
      const gitDir = path.join(process.cwd(), '.git');
      debugOutput += `\n  .git directory exists: ${fs.existsSync(gitDir) ? '✅ Yes' : '❌ No'}`;
      if (fs.existsSync(gitDir)) {
        const headFile = path.join(gitDir, 'HEAD');
        debugOutput += `\n  HEAD file exists: ${fs.existsSync(headFile) ? '✅ Yes' : '❌ No'}`;
        if (fs.existsSync(headFile)) {
          const headContent = fs.readFileSync(headFile, 'utf8');
          debugOutput += `\n  HEAD content: ${headContent.trim()}`;
        }
      }
    } catch (error) {
      debugOutput += `\n  Error checking Git structure: ${error}`;
    }

    console.log(debugOutput);
  });

// Default action for commit when no subcommand is provided
program.action(async (): Promise<void> => {
  try {
    // Import only when needed to avoid loading heavy dependencies
    const { CommitX } = await import('./core/commitx.js');
    const commitX = new CommitX();
    await commitX.commit(); // Uses AI processing by default
  } catch (error) {
    handleErrorImmediate(error);
  }
});

// Error handling for unknown commands
program.on('command:*', async (): Promise<void> => {
  console.error(chalk.red(`❌ Unknown command: ${program.args.join(' ')}`));
  console.log(`${chalk.yellow('\n💡 Available commands:')}
${chalk.blue('  cx --help              # Show all available commands')}
${chalk.blue('  cx commit --help       # Show commit command options')}
${chalk.blue('  cx help-examples       # Show usage examples')}
${chalk.gray('\nFor more information, visit: https://github.com/sojanvarghese/commitx')}`);
  process.exit(1);
});

// Error handling for invalid options
program.on('option:*', async (): Promise<void> => {
  console.error(chalk.red(`❌ Unknown option: ${program.args.join(' ')}`));
  console.log(`${chalk.yellow('\n💡 Available options:')}
${chalk.blue('  cx --help              # Show all available commands')}
${chalk.blue('  cx commit --help       # Show commit command options')}
${chalk.gray('\nFor more information, visit: https://github.com/sojanvarghese/commitx')}`);
  process.exit(1);
});

// Performance monitoring exit handler
if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING) {
  process.on('exit', () => {
    const monitor = PerformanceMonitor.getInstance();
    monitor.logMetrics();
  });
}

// Parse command line arguments
if (process.argv.length === 2) {
  // No arguments provided, run default commit
  void (async (): Promise<void> => {
    try {
      // Import only when needed to avoid loading heavy dependencies
      await withPerformanceTracking('default-commit', async () => {
        const { CommitX } = await import('./core/commitx.js');
        const commitX = new CommitX();
        await commitX.commit();
      });
    } catch (error) {
      handleErrorImmediate(error);
    }
  })();
} else {
  program.parse(process.argv);
}
