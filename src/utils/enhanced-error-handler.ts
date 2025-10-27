// Enhanced error handling system with user-friendly messages and actionable suggestions

import { lightColors } from './colors.js';

export interface ErrorContext {
  operation?: string;
  file?: string;
  command?: string;
  suggestion?: string;
  details?: Record<string, any>;
}

export interface UserFriendlyError {
  title: string;
  message: string;
  suggestions: string[];
  technicalDetails?: string;
  helpUrl?: string;
}

/**
 * Enhanced error handler with user-friendly messages
 */
export class EnhancedErrorHandler {
  private static instance: EnhancedErrorHandler;
  private errorCounts = new Map<string, number>();
  private readonly maxRetries = 3;

  private constructor() {}

  static getInstance(): EnhancedErrorHandler {
    if (!EnhancedErrorHandler.instance) {
      EnhancedErrorHandler.instance = new EnhancedErrorHandler();
    }
    return EnhancedErrorHandler.instance;
  }

  /**
   * Convert technical errors into user-friendly messages
   */
  createUserFriendlyError(error: Error | string, context?: ErrorContext): UserFriendlyError {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const errorType = this.categorizeError(errorMessage, context);

    return this.getErrorMapping(errorType, errorMessage, context);
  }

  /**
   * Display user-friendly error with formatting
   */
  displayError(error: Error | string, context?: ErrorContext): void {
    const friendlyError = this.createUserFriendlyError(error, context);

    console.error('\n' + lightColors.red('❌ ' + friendlyError.title));
    console.error(lightColors.gray(friendlyError.message));

    if (friendlyError.suggestions.length > 0) {
      console.error('\n' + lightColors.yellow('💡 Suggestions:'));
      friendlyError.suggestions.forEach((suggestion, index) => {
        console.error(`  ${index + 1}. ${suggestion}`);
      });
    }

    if (friendlyError.helpUrl) {
      console.error('\n' + lightColors.blue(`📖 Learn more: ${friendlyError.helpUrl}`));
    }

    if (friendlyError.technicalDetails && process.env.DEBUG) {
      console.error('\n' + lightColors.dim('🔍 Technical Details:'));
      console.error(lightColors.dim(friendlyError.technicalDetails));
    }
  }

  /**
   * Handle retry logic with user-friendly feedback
   */
  async handleWithRetry<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    maxRetries = this.maxRetries
  ): Promise<T> {
    const operationKey = `${context.operation || 'unknown'}:${context.file || 'global'}`;
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const result = await operation();
        // Reset error count on success
        this.errorCounts.delete(operationKey);
        return result;
      } catch (error) {
        attempts++;
        this.errorCounts.set(operationKey, attempts);

        if (attempts >= maxRetries) {
          // Final failure - show comprehensive error
          this.displayError(error as Error, {
            ...context,
            suggestion: `Operation failed after ${attempts} attempts. This might indicate a persistent issue.`
          });
          throw error;
        } else {
          // Retry with user feedback
          const friendlyError = this.createUserFriendlyError(error as Error, context);
          console.warn(lightColors.yellow(`⚠️  ${friendlyError.title} (attempt ${attempts}/${maxRetries})`));
          console.warn(lightColors.gray(`   Retrying in ${attempts * 1000}ms...`));

          await new Promise(resolve => setTimeout(resolve, attempts * 1000));
        }
      }
    }

    throw new Error('Unexpected retry loop completion');
  }

  private categorizeError(errorMessage: string, context?: ErrorContext): string {
    const message = errorMessage.toLowerCase();

    // Git-related errors
    if (message.includes('not a git repository') || message.includes('fatal: not a git repository')) {
      return 'not-git-repo';
    }
    if (message.includes('permission denied') || message.includes('eacces')) {
      return 'permission-denied';
    }
    if (message.includes('network') || message.includes('timeout') || message.includes('enotfound')) {
      return 'network-error';
    }

    // API-related errors
    if (message.includes('api key') || message.includes('unauthorized') || message.includes('401')) {
      return 'api-key-error';
    }
    if (message.includes('rate limit') || message.includes('429')) {
      return 'rate-limit';
    }
    if (message.includes('quota') || message.includes('billing')) {
      return 'quota-exceeded';
    }

    // File-related errors
    if (message.includes('enoent') || message.includes('no such file')) {
      return 'file-not-found';
    }
    if (message.includes('eisdir') || message.includes('is a directory')) {
      return 'is-directory';
    }

    // Configuration errors
    if (message.includes('config') || message.includes('configuration')) {
      return 'config-error';
    }

    // Validation errors
    if (message.includes('invalid') || message.includes('validation')) {
      return 'validation-error';
    }

    return 'generic-error';
  }

  private getErrorMapping(errorType: string, originalMessage: string, context?: ErrorContext): UserFriendlyError {
    const errorMappings: Record<string, UserFriendlyError> = {
      'not-git-repo': {
        title: 'Not a Git Repository',
        message: 'This directory is not initialized as a Git repository.',
        suggestions: [
          'Run "git init" to initialize a new Git repository',
          'Navigate to a directory that contains a Git repository',
          'Clone an existing repository with "git clone <url>"'
        ],
        helpUrl: 'https://github.com/sojanvarghese/commitx#getting-started'
      },

      'permission-denied': {
        title: 'Permission Denied',
        message: 'CommitX doesn\'t have the necessary permissions to perform this operation.',
        suggestions: [
          'Check file and directory permissions',
          'Run with appropriate user permissions (avoid sudo if possible)',
          'Ensure you have write access to the Git repository',
          'Check if files are locked by another process'
        ],
        technicalDetails: originalMessage
      },

      'network-error': {
        title: 'Network Connection Problem',
        message: 'Unable to connect to the AI service. This could be a temporary network issue.',
        suggestions: [
          'Check your internet connection',
          'Verify firewall settings allow HTTPS connections',
          'Try again in a few moments',
          'Use --dry-run to test without AI calls'
        ],
        technicalDetails: originalMessage
      },

      'api-key-error': {
        title: 'API Key Problem',
        message: 'There\'s an issue with your AI service API key.',
        suggestions: [
          'Run "cx setup" to configure your API key',
          'Verify your API key is valid at https://makersuite.google.com/app/apikey',
          'Check that GEMINI_API_KEY environment variable is set correctly',
          'Ensure your API key has the necessary permissions'
        ],
        helpUrl: 'https://github.com/sojanvarghese/commitx#setup'
      },

      'rate-limit': {
        title: 'API Rate Limit Reached',
        message: 'You\'ve exceeded the API rate limit. Please wait before making more requests.',
        suggestions: [
          'Wait a few minutes before trying again',
          'Consider upgrading your API plan if you need higher limits',
          'Use --dry-run to test without API calls',
          'Process files in smaller batches'
        ],
        technicalDetails: originalMessage
      },

      'quota-exceeded': {
        title: 'API Quota Exceeded',
        message: 'Your API usage quota has been exceeded.',
        suggestions: [
          'Check your API usage dashboard',
          'Wait until your quota resets (usually monthly)',
          'Consider upgrading your API plan',
          'Use more selective file processing'
        ],
        helpUrl: 'https://console.cloud.google.com/apis/dashboard'
      },

      'file-not-found': {
        title: 'File Not Found',
        message: `The file "${context?.file || 'specified file'}" could not be found.`,
        suggestions: [
          'Check that the file path is correct',
          'Verify the file hasn\'t been moved or deleted',
          'Make sure you\'re in the correct directory',
          'Use "git status" to see available files'
        ],
        technicalDetails: originalMessage
      },

      'config-error': {
        title: 'Configuration Error',
        message: 'There\'s an issue with your CommitX configuration.',
        suggestions: [
          'Run "cx config get" to check current settings',
          'Run "cx config reset" to restore defaults',
          'Check that all configuration values are valid',
          'Run "cx setup" to reconfigure from scratch'
        ],
        technicalDetails: originalMessage
      },

      'validation-error': {
        title: 'Invalid Input',
        message: 'The provided input doesn\'t meet the required format or constraints.',
        suggestions: [
          'Check the input format matches the expected pattern',
          'Ensure all required fields are provided',
          'Verify that values are within acceptable ranges',
          'Use "cx help-examples" to see correct usage'
        ],
        technicalDetails: originalMessage
      }
    };

    return errorMappings[errorType] || {
      title: 'Unexpected Error',
      message: 'An unexpected error occurred.',
      suggestions: [
        'Try running the command again',
        'Check if the issue persists with different files',
        'Run with DEBUG=1 for more detailed error information',
        'Report this issue if it continues: https://github.com/sojanvarghese/commitx/issues'
      ],
      technicalDetails: originalMessage,
      helpUrl: 'https://github.com/sojanvarghese/commitx/issues'
    };
  }

  /**
   * Clear error counts (useful for testing or reset)
   */
  clearErrorCounts(): void {
    this.errorCounts.clear();
  }

  /**
   * Get error statistics
   */
  getErrorStats(): { totalErrors: number; errorsByType: Record<string, number> } {
    const errorsByType: Record<string, number> = {};
    let totalErrors = 0;

    this.errorCounts.forEach((count, key) => {
      const [operation] = key.split(':');
      errorsByType[operation] = (errorsByType[operation] || 0) + count;
      totalErrors += count;
    });

    return { totalErrors, errorsByType };
  }
}

/**
 * Convenience function for displaying user-friendly errors
 */
export const displayUserFriendlyError = (error: Error | string, context?: ErrorContext): void => {
  EnhancedErrorHandler.getInstance().displayError(error, context);
};

/**
 * Wrapper for operations with enhanced error handling and retry logic
 */
export const withEnhancedErrorHandling = async <T>(
  operation: () => Promise<T>,
  context: ErrorContext
): Promise<T> => {
  return EnhancedErrorHandler.getInstance().handleWithRetry(operation, context);
};
