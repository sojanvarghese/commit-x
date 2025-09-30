import chalk from 'chalk';
import { UI_CONSTANTS } from '../constants/ui.js';

/**
 * Utility functions for process management and error handling
 */

/**
 * Exits the process with a delay to prevent lingering HTTP connections
 * @param exitCode - Exit code (0 for success, 1 for error)
 */
export const exitProcess = (exitCode: number = 0): void => {
  setTimeout(() => process.exit(exitCode), UI_CONSTANTS.EXIT_DELAY_MS);
};

/**
 * Handles errors with consistent logging and process exit
 * @param error - The error to handle
 * @param context - Optional context for the error
 */
export const handleError = (error: unknown, context?: string): void => {
  const errorMessage = context ? `${context}: ${error}` : `Error: ${error}`;
  console.error(chalk.red(errorMessage));
  exitProcess(1);
};

/**
 * Handles errors with immediate process exit (no delay)
 * @param error - The error to handle
 * @param context - Optional context for the error
 */
export const handleErrorImmediate = (error: unknown, context?: string): void => {
  const errorMessage = context ? `${context}: ${error}` : `Error: ${error}`;
  console.error(chalk.red(errorMessage));
  process.exit(1);
};

