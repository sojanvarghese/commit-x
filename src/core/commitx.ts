import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import process from 'process';
import { match } from 'ts-pattern';
import { GitService } from '../services/git.js';
import { AIService } from '../services/ai.js';
import type { CommitOptions, CommitSuggestion, GitDiff } from '../types/common.js';
import { getFileTypeFromExtension } from '../schemas/validation.js';
import { LARGE_FILE_THRESHOLD } from '../constants/ai.js';
import { PERFORMANCE_CONSTANTS } from '../constants/performance.js';
import { WARNING_MESSAGES, SUCCESS_MESSAGES, INFO_MESSAGES } from '../constants/messages.js';
import { UI_CONSTANTS } from '../constants/ui.js';
import { FILE_TYPE_CONFIGS, PATTERNS } from '../constants/commitx.js';
import { BUILD_DIR_PATTERNS } from '../constants/security.js';
import { exitProcess, handleError } from '../utils/process-utils.js';
import { ConfigManager } from '../config.js';

export class CommitX {
  private readonly gitService: GitService;
  private readonly configManager: ConfigManager;
  private static aiServiceInstance: AIService | null = null;

  constructor() {
    this.gitService = new GitService();
    this.configManager = ConfigManager.getInstance();
  }

  private readonly getFileName = (filePath: string): string =>
     filePath.split('/').pop() ?? filePath;

  private getAIService(): AIService {
    if (!CommitX.aiServiceInstance) {
      try {
        CommitX.aiServiceInstance = new AIService();
      } catch (error) {
        throw new Error(`Failed to initialize AI service: ${error}`);
      }
    }
    return CommitX.aiServiceInstance;
  }

  commit = async (options: CommitOptions = {}): Promise<void> => {
    try {
      if (!(await this.gitService.isGitRepository())) {
        throw new Error(
          'Not a git repository. Please run this command from within a git repository.'
        );
      }

      if (options.message || options.all) {
        return this.commitTraditional(options);
      }

      const unstagedFiles = await this.gitService.getUnstagedFiles();

      if (unstagedFiles.length === 0) {
        console.log(chalk.yellow(WARNING_MESSAGES.NO_CHANGES_DETECTED));
        return;
      }

      // Process files with AI for optimal performance
      const processedCount = await this.commitFilesBatch(unstagedFiles, options);

      console.log(
        chalk.green( processedCount > 1 ?
          `\n✅ Successfully processed ${processedCount} of ${unstagedFiles.length} files.` :
          `\n✅ Successfully processed the file.`
          )
      );

      // Force exit to prevent delay from lingering HTTP connections
      if (options.dryRun || processedCount > 0) {
        exitProcess(0);
      }
    } catch (error) {
      handleError(error);
    }
  };

  private readonly commitTraditional = async (options: CommitOptions): Promise<void> => {
    const status = await this.gitService.getStatus();

    if (status.staged.length === 0) {
      if (status.unstaged.length > 0 || status.untracked.length > 0) {
        const shouldStage = await this.promptStageFiles(status);
        if (shouldStage) {
          const spinner = ora(UI_CONSTANTS.SPINNER_MESSAGES.STAGING).start();
          await this.gitService.stageAll();
          spinner.succeed(SUCCESS_MESSAGES.FILES_STAGED);
        } else {
          console.log(chalk.yellow(WARNING_MESSAGES.NO_FILES_STAGED));
          return;
        }
      } else {
        console.log(chalk.yellow(WARNING_MESSAGES.NO_CHANGES_DETECTED));
        return;
      }
    }

    const commitMessage: string =
      options.message ?? (await this.generateCommitMessage(options.interactive));

    if (!commitMessage) {
      console.log(chalk.yellow(WARNING_MESSAGES.NO_COMMIT_MESSAGE));
      return;
    }

    if (options.dryRun) {
      console.log(`${chalk.blue(INFO_MESSAGES.DRY_RUN_COMMIT)}
${chalk.white(`"${commitMessage}"`)}`);
      return;
    }

    const commitSpinner = ora(UI_CONSTANTS.SPINNER_MESSAGES.COMMITTING).start();
    await this.gitService.commit(commitMessage);
    commitSpinner.succeed(`Committed: ${chalk.green(commitMessage)}`);

    // Force exit to prevent delay from lingering HTTP connections
    exitProcess(0);
  };

  private readonly commitFilesBatch = async (
    files: string[],
    options: CommitOptions
  ): Promise<number> => {
    const config = this.configManager.getConfig();
    const aggregationEnabled = options.aggregate ?? config.aggregation?.enabled ?? true;

    // Check if we should use aggregated commits
    if (aggregationEnabled && files.length > 1) {
      return this.commitFilesAggregated(files, options);
    } else {
      return this.commitFilesIndividual(files, options);
    }
  };

  private readonly commitFilesAggregated = async (
    files: string[],
    options: CommitOptions
  ): Promise<number> => {
    const spinner = ora('Analyzing files for intelligent grouping...').start();

    try {
      // Collect all file diffs for AI grouping analysis
      const allDiffs: GitDiff[] = [];
      const skippedFiles: string[] = [];

      for (const file of files) {
        try {
          const fileDiff = await this.gitService.getFileDiff(file, false);
          const totalChanges = fileDiff.additions + fileDiff.deletions;

          if (this.shouldSkipFile(fileDiff, totalChanges)) {
            this.logSkippedFile(this.getFileName(file), fileDiff);
            skippedFiles.push(file);
            continue;
          }

          allDiffs.push(fileDiff);
        } catch (error) {
          console.error(`Failed to analyze ${file}: ${error}`);
          skippedFiles.push(file);
        }
      }

      if (allDiffs.length === 0) {
        spinner.fail('No valid files to process');
        return 0;
      }

      spinner.text = 'Using AI to group related changes...';

      // Use AI to determine optimal grouping
      const aggregatedResult = await this.getAIService().generateAggregatedCommits(allDiffs);

      if (aggregatedResult.fallbackToIndividual || aggregatedResult.groups.length === 0) {
        spinner.fail('AI grouping failed, falling back to individual commits');
        return this.commitFilesIndividual(files, options);
      }

      spinner.succeed(
        `AI grouped ${allDiffs.length} files into ${aggregatedResult.groups.length} logical commits`
      );

      // Process each commit group
      let processedCount = 0;
      for (const group of aggregatedResult.groups) {
        try {
          const groupName = group.files.length > 1
            ? `${group.files.length} files`
            : this.getFileName(group.files[0]);

          if (options.dryRun) {
            console.log(`${chalk.blue(`  Would commit ${groupName}:`)}
${chalk.gray(`  Files: ${group.files.map(f => this.getFileName(f)).join(', ')}`)}
${chalk.blue(`  Message: "${group.message}"`)}`);
          } else {
            const commitSpinner = ora(`Committing ${groupName}...`).start();

            // Stage all files in the group
            for (const file of group.files) {
              await this.gitService.stageFile(file);
            }

            // Wait for Git to release any lock files naturally
            await this.gitService.waitForLockRelease();

            // Commit the group
            await this.gitService.commit(group.message);

            commitSpinner.succeed(`✅ ${groupName}: ${group.message}`);
          }

          processedCount += group.files.length;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`  Failed to commit group: ${errorMessage}`));
        }
      }

      if (skippedFiles.length > 0) {
        console.log(
          chalk.yellow(`Skipped ${skippedFiles.length} files (empty or failed analysis)`)
        );
      }

      return processedCount;
    } catch (error) {
      spinner.fail('Aggregated commit processing failed');
      console.error(chalk.red(`Aggregated processing error: ${error}`));
      console.log(chalk.yellow('Falling back to individual commits...'));
      return this.commitFilesIndividual(files, options);
    }
  };

  private readonly commitFilesIndividual = async (
    files: string[],
    options: CommitOptions
  ): Promise<number> => {
    const spinner = ora('Analyzing files for batch processing...').start();

    try {
      // Analyze and categorize files
      const { aiEligibleFiles, summaryFiles, skippedFiles } =
        await this.analyzeFilesForBatch(files);

      spinner.succeed(
        `Analyzed ${files.length} files: ${aiEligibleFiles.length} for AI processing, ${summaryFiles.length} for summary messages`
      );

      // Generate AI commit messages
      const aiCommitMessages = await this.generateBatchCommitMessages(aiEligibleFiles);
      const processedCount = await this.processBatchCommits(
        aiEligibleFiles,
        summaryFiles,
        aiCommitMessages,
        options
      );

      if (skippedFiles.length > 0) {
        console.log(
          chalk.yellow(`Skipped ${skippedFiles.length} files (empty or failed analysis)`)
        );
      }

      return processedCount;
    } catch (error) {
      spinner.fail('Batch processing failed');
      console.error(chalk.red(`Batch processing error: ${error}`));
      return 0;
    }
  };

  private readonly analyzeFilesForBatch = async (files: string[]): Promise<{
    aiEligibleFiles: { file: string; diff: GitDiff }[];
    summaryFiles: { file: string; diff: GitDiff }[];
    skippedFiles: string[];
  }> => {
    const aiEligibleFiles: { file: string; diff: GitDiff }[] = [];
    const summaryFiles: { file: string; diff: GitDiff }[] = [];
    const skippedFiles: string[] = [];

    // Process files in parallel for better performance
    const BATCH_SIZE = PERFORMANCE_CONSTANTS.FILE_BATCH_SIZE;
    const batches = Array.from(
      { length: Math.ceil(files.length / BATCH_SIZE) },
      (_, i) => files.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
    );

    for (const batch of batches) {
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const fileName = this.getFileName(file);
          const fileDiff = await this.gitService.getFileDiff(file, false);
          const totalChanges = fileDiff.additions + fileDiff.deletions;
          return { file, fileName, fileDiff, totalChanges };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { file, fileName, fileDiff, totalChanges } = result.value;

          // Skip truly empty files
          if (this.shouldSkipFile(fileDiff, totalChanges)) {
            this.logSkippedFile(fileName, fileDiff);
            skippedFiles.push(file);
            continue;
          }

          // Categorize files
          if (this.shouldUseSummaryMessage(file, totalChanges)) {
            summaryFiles.push({ file, diff: fileDiff });
          } else {
            aiEligibleFiles.push({ file, diff: fileDiff });
          }
        } else {
          // Handle rejected promises
          const file = batch[results.indexOf(result)];
          const fileName = this.getFileName(file);
          console.error(`Failed to analyze ${fileName}: ${result.reason}`);
          skippedFiles.push(file);
        }
      }
    }

    return { aiEligibleFiles, summaryFiles, skippedFiles };
  };

  private readonly shouldSkipFile = (fileDiff: GitDiff, totalChanges: number): boolean => {
    return (
      totalChanges === 0 &&
      (!fileDiff.changes || fileDiff.changes.trim() === '') &&
      !fileDiff.isDeleted
    );
  };

  private readonly logSkippedFile = (fileName: string, fileDiff: GitDiff): void => {
    if (fileDiff.isNew) {
      console.log(chalk.yellow(`  Skipping empty new file: ${fileName}`));
    } else {
      console.log(chalk.yellow(`  Skipping file with no changes: ${fileName}`));
    }
  };

  private readonly generateBatchCommitMessages = async (
    aiEligibleFiles: { file: string; diff: GitDiff }[]
  ): Promise<{ [filename: string]: string }> => {
    const aiCommitMessages: { [filename: string]: string } = {};

    if (aiEligibleFiles.length === 0) {
      return aiCommitMessages;
    }

    const aiSpinner = ora(
      `Generating commit messages for ${aiEligibleFiles.length} files...`
    ).start();

    try {
      const aiDiffs = aiEligibleFiles.map((item) => item.diff);
      const batchResults = await this.getAIService().generateBatchCommitMessages(aiDiffs);

      // Extract the first (best) commit message for each file
      for (const { file } of aiEligibleFiles) {
        const suggestions = batchResults[file];
        aiCommitMessages[file] =
          suggestions?.[0]?.message ??
          this.generateFallbackCommitMessage(
            file,
            aiEligibleFiles.find((item) => item.file === file)?.diff ?? { file, additions: 0, deletions: 0, changes: '', isNew: false, isDeleted: false, isRenamed: false }
          );
      }
      aiSpinner.succeed(`Generated ${Object.keys(aiCommitMessages).length} AI commit messages`);
    } catch (error) {
      aiSpinner.fail('AI generation failed, using fallback messages');
      console.warn(chalk.yellow('Using fallback messages due to AI error:'), error);

      // Generate fallback messages for all AI-eligible files
      for (const { file, diff } of aiEligibleFiles) {
        aiCommitMessages[file] = this.generateFallbackCommitMessage(file, diff);
      }
    }

    return aiCommitMessages;
  };

  private readonly processBatchCommits = async (
    aiEligibleFiles: { file: string; diff: GitDiff }[],
    summaryFiles: { file: string; diff: GitDiff }[],
    aiCommitMessages: { [filename: string]: string },
    options: CommitOptions
  ): Promise<number> => {
    const commitSpinner = ora(
      options.dryRun ? 'Analyzing files...' : 'Committing files...'
    ).start();
    let processedCount = 0;

    // Process AI-eligible files
    for (const { file, diff } of aiEligibleFiles) {
      try {
        const fileName = this.getFileName(file);
        const commitMessage = aiCommitMessages[file];

        if (options.dryRun) {
          console.log(`${chalk.blue(`  Would stage and commit: ${fileName}`)}
${chalk.gray(`  Changes: +${diff.additions}/-${diff.deletions}`)}
${chalk.blue(`  Message: "${commitMessage}"`)}`);
        } else {
          await this.gitService.stageFile(file);
          // Wait for Git to release any lock files naturally
          await this.gitService.waitForLockRelease();
          await this.gitService.commit(commitMessage);
          console.log(chalk.green(`✅ ${fileName}: ${commitMessage}`));
        }
        processedCount++;
      } catch (error) {
        const fileName = this.getFileName(file);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if it's a Git lock file error and provide helpful guidance
        if (errorMessage.includes('index.lock') || errorMessage.includes('File exists')) {
          console.error(chalk.red(`  Failed to process ${fileName}: Git lock file detected`));
          console.error(chalk.yellow(`  💡 Try running: rm -f .git/index.lock`));
        } else {
          console.error(chalk.red(`  Failed to process ${fileName}: ${errorMessage}`));
        }
      }
    }

    // Process summary files
    for (const { file, diff } of summaryFiles) {
      try {
        const fileName = this.getFileName(file);
        const commitMessage = this.generateSummaryCommitMessage(file, diff);

        if (options.dryRun) {
          console.log(`${chalk.blue(`  Would stage and commit: ${fileName}`)}
${chalk.gray(`  Changes: +${diff.additions}/-${diff.deletions}`)}
${chalk.blue(`  Message: "${commitMessage}"`)}`);
        } else {
          await this.gitService.stageFile(file);
          // Wait for Git to release any lock files naturally
          await this.gitService.waitForLockRelease();
          await this.gitService.commit(commitMessage);
          console.log(chalk.green(`✅ ${fileName}: ${commitMessage}`));
        }
        processedCount++;
      } catch (error) {
        const fileName = this.getFileName(file);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if it's a Git lock file error and provide helpful guidance
        if (errorMessage.includes('index.lock') || errorMessage.includes('File exists')) {
          console.error(chalk.red(`  Failed to process ${fileName}: Git lock file detected`));
          console.error(chalk.yellow(`  💡 Try running: rm -f .git/index.lock`));
        } else {
          console.error(chalk.red(`  Failed to process ${fileName}: ${errorMessage}`));
        }
      }
    }

    commitSpinner.succeed(`Committed ${processedCount} files successfully`);
    return processedCount;
  };


  private readonly shouldUseSummaryMessage = (file: string, totalChanges: number): boolean => {
    const fileName = file.toLowerCase();
    const baseName = this.getFileName(file).toLowerCase();
    const fileType = getFileTypeFromExtension(fileName);
    const fileExtension = `.${fileName.split('.').pop() ?? ''}`;

    // Helper function to check if file is in build directory but is source code
    const isSourceCodeInBuildDir = (filePath: string, ext: string): boolean => {
      const isInBuildDir = BUILD_DIR_PATTERNS.some((pattern) => filePath.includes(pattern));
      const isSourceCode = PATTERNS.sourceCodeExtensions.includes(ext);
      return isInBuildDir && isSourceCode;
    };

    // Check for lock files (always use summary)
    if (PATTERNS.lockFiles.some((pattern) => fileName.includes(pattern))) {
      return true;
    }

    // Check for generated files (always use summary) - more specific patterns
    if (PATTERNS.generatedFiles.some((pattern) => fileName.includes(pattern))) {
      return true;
    }

    // Check for compiled files (always use summary) - more specific patterns
    if (PATTERNS.compiledFiles.some((pattern) => fileName.includes(pattern))) {
      return true;
    }

    // Check for build directories (always use summary) - but exclude source code
    if (PATTERNS.buildDirs.some((pattern) => fileName.includes(pattern))) {
      // If it's source code in a build directory, don't use summary
      if (isSourceCodeInBuildDir(file, fileExtension)) {
        return false;
      }
      return true;
    }

    // Check for changelog files (always use summary)
    if (PATTERNS.changelogFiles.some((pattern) => fileName.toLowerCase().includes(pattern))) {
      return true;
    }

    // Check for log and temporary files (always use summary) - more specific patterns
    if (
      PATTERNS.logFiles.some((pattern) => baseName.includes(pattern) || fileName.includes(pattern))
    ) {
      return true;
    }

    // Check for bundle files (always use summary) - more specific patterns
    if (PATTERNS.bundleFiles.some((pattern) => fileName.includes(pattern))) {
      return true;
    }

    // Check for package files with significant changes
    if (PATTERNS.packageFiles.some((pattern) => fileName.includes(pattern)) && totalChanges > 20) {
      return true;
    }

    // Check for large files
    if (totalChanges > LARGE_FILE_THRESHOLD) {
      return true;
    }

    // Check for certain file types - always use summary for these
    if (['json', 'xml', 'css', 'scss', 'less'].includes(fileType)) {
      return true;
    }

    // Check for documentation files - always use summary for these
    if (
      ['markdown', 'unknown'].includes(fileType) &&
      (fileName.endsWith('.md') || fileName.endsWith('.txt') || fileName.endsWith('.rst'))
    ) {
      return true;
    }

    return false;
  };

  private readonly generateSummaryCommitMessage = (file: string, fileDiff: GitDiff): string => {
    const fileName = this.getFileName(file);
    const baseName = fileName.toLowerCase();
    const totalChanges = fileDiff.additions + fileDiff.deletions;

    // Helper function to generate dependency change message
    const getDependencyChangeMessage = (config: { name: string; type: string }): string => {
      const isAdding = fileDiff.additions > fileDiff.deletions * 2;
      const isRemoving = fileDiff.deletions > fileDiff.additions * 2;

      if (isAdding) return `Added new ${config.type} to ${config.name}`;
      if (isRemoving) return `Removed ${config.type} from ${config.name}`;
      return `Updated ${config.type} in ${config.name}`;
    };

    // Check for lock files
    for (const [pattern, config] of Object.entries(FILE_TYPE_CONFIGS.lockFiles)) {
      if (baseName.includes(pattern)) {
        return getDependencyChangeMessage(config);
      }
    }

    // Check for package files
    for (const [pattern, config] of Object.entries(FILE_TYPE_CONFIGS.packageFiles)) {
      if (baseName.includes(pattern)) {
        return getDependencyChangeMessage(config);
      }
    }

    // Check for changelog files
    for (const [pattern, message] of Object.entries(FILE_TYPE_CONFIGS.changelogFiles)) {
      if (baseName.includes(pattern)) {
        return message;
      }
    }

    // Check for build directories
    for (const [pattern, message] of Object.entries(FILE_TYPE_CONFIGS.buildDirs)) {
      if (file.includes(pattern)) {
        return message;
      }
    }

    // Check for generated files - more specific patterns
    if (PATTERNS.generatedFiles.some((pattern) => fileName.includes(pattern))) {
      return `Updated generated file ${fileName}`;
    }

    // Check for compiled files - more specific patterns
    if (PATTERNS.compiledFiles.some((pattern) => fileName.includes(pattern))) {
      return `Updated compiled ${fileName}`;
    }

    // Check for build directories - but exclude source code
    const fileExtension = `.${fileName.split('.').pop() ?? ''}`;
    const isSourceCodeInBuildDir = (filePath: string, ext: string): boolean => {
      const isInBuildDir = BUILD_DIR_PATTERNS.some((pattern) => filePath.includes(pattern));
      const isSourceCode = PATTERNS.sourceCodeExtensions.includes(ext);
      return isInBuildDir && isSourceCode;
    };

    if (
      file.includes('/dist/') ||
      file.includes('/out/') ||
      file.includes('/target/') ||
      (file.includes('/build/') && !isSourceCodeInBuildDir(file, fileExtension))
    ) {
      return `Updated compiled ${fileName}`;
    }

    // Check for bundle files - more specific patterns
    if (PATTERNS.bundleFiles.some((pattern) => baseName.includes(pattern))) {
      return `Updated bundled ${fileName}`;
    }

    // Check for log and temporary files - more specific patterns
    if (PATTERNS.logFiles.some((pattern) => baseName.includes(pattern) || file.includes(pattern))) {
      return `Updated ${fileName}`;
    }

    // Check for large files
    if (totalChanges > LARGE_FILE_THRESHOLD) {
      return `Implemented comprehensive functionality in ${fileName}`;
    }

    // Check for configuration files
    if (baseName.endsWith('.json')) {
      return `Updated ${fileName} configuration`;
    }

    // Check for style files
    if (
      (baseName.endsWith('.css') || baseName.endsWith('.scss') || baseName.endsWith('.less'))
    ) {
      return `Updated ${fileName} styles`;
    }

    // Check for documentation files
    if (
      (baseName.endsWith('.md') || baseName.endsWith('.txt') || baseName.endsWith('.rst'))
    ) {
      return `Updated ${fileName} documentation`;
    }

    return `Updated ${fileName} functionality`;
  };

  private readonly generateFallbackCommitMessage = (file: string, fileDiff: GitDiff): string => {
    const fileName = this.getFileName(file);

    return match(fileDiff)
      .when(
        (diff) => diff.isNew,
        () => `Created new ${fileName} file with initial implementation`
      )
      .when(
        (diff) => diff.isDeleted,
        () => `Removed ${fileName} file as it is no longer needed`
      )
      .when(
        (diff) => diff.additions > diff.deletions * 2,
        () => `Added new functionality and features to ${fileName} file`
      )
      .when(
        (diff) => diff.deletions > diff.additions * 2,
        () => `Removed unused code and functions from ${fileName} file`
      )
      .otherwise(() => `Modified ${fileName} file with code improvements and updates`);
  };

  private readonly generateCommitMessage = async (interactive: boolean = true): Promise<string> => {
    const spinner = ora('Analyzing changes...').start();

    try {
      const diffs = await this.gitService.getStagedDiff();

      if (diffs.length === 0) {
        spinner.fail('No staged changes found');
        return '';
      }

      spinner.text = 'Generating commit messages...';

      const suggestions = await this.getAIService().generateCommitMessage(diffs);

      spinner.succeed(`Generated ${suggestions.length} commit message suggestions`);

      if (!interactive || !process.stdin.isTTY) {
        return suggestions[0]?.message || '';
      }

      return await this.promptCommitSelection(suggestions);
    } catch (error) {
      spinner.fail(`Failed to generate commit message: ${error}`);
      throw error;
    }
  };

  private readonly promptCommitSelection = async (
    suggestions: CommitSuggestion[],
    file?: string
  ): Promise<string> => {
    const choices = suggestions.map((suggestion) => ({
      name: `${chalk.green(suggestion.message)}${suggestion.description ? chalk.gray(` - ${suggestion.description}`) : ''}`,
      value: suggestion.message,
      short: suggestion.message,
    }));

    choices.push({
      name: chalk.blue('✏️  Write custom message'),
      value: 'custom',
      short: 'Custom',
    });

    if (file) {
      choices.push({ name: chalk.yellow('⏭️  Skip this file'), value: 'skip', short: 'Skip' });
    }

    choices.push({ name: chalk.red('❌ Cancel'), value: 'cancel', short: 'Cancel' });

    const message = file
      ? `Select commit message for ${chalk.cyan(file)}:`
      : 'Select a commit message:';

    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message,
        choices,
        pageSize: UI_CONSTANTS.PAGE_SIZE,
      },
    ]);

    switch (selected) {
      case 'cancel':
      case 'skip':
        return '';

      case 'custom':
        const { customMessage } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customMessage',
            message: `Enter commit message${file ? ` for ${chalk.cyan(file)}` : ''}:`,
            validate: (input: string): string | boolean => {
              if (!input.trim()) {
                return 'Commit message cannot be empty';
              }
              if (input.length > 72) {
                return 'First line should be 72 characters or less';
              }
              return true;
            },
          },
        ]);
        return customMessage;

      default:
        return selected;
    }
  };

  private readonly promptStageFiles = async (status: {
    unstaged: string[];
    untracked: string[];
  }): Promise<boolean> => {
    let output = `${chalk.yellow('\nUnstaged changes detected:')}`;

    if (status.unstaged.length > 0) {
      output += `\n${chalk.yellow('Modified files:')}`;
      output += status.unstaged.map((file: string) => `\n  ${chalk.red('M')} ${file}`).join('');
    }

    if (status.untracked.length > 0) {
      output += `\n${chalk.yellow('Untracked files:')}`;
      output += status.untracked.map((file: string) => `\n  ${chalk.red('??')} ${file}`).join('');
    }

    console.log(output);

    const { shouldStage } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'shouldStage',
        message: 'Stage all changes and continue?',
        default: true,
      },
    ]);

    return shouldStage;
  };

  status = async (): Promise<void> => {
    try {
      if (!(await this.gitService.isGitRepository())) {
        console.log(chalk.red('Not a git repository'));
        return;
      }

      const status = await this.gitService.getStatus();
      const repoInfo = await this.gitService.getRepoInfo();

      let statusOutput = `${chalk.bold(`\n📁 Repository: ${repoInfo.name}`)}
${chalk.bold(`🌿 Branch: ${repoInfo.branch}`)}
`;

      if (status.staged.length > 0) {
        statusOutput += `\n${chalk.green('✅ Staged changes:')}`;
        statusOutput += status.staged.map((file) => `\n  ${chalk.green('A')} ${file}`).join('');
        statusOutput += '\n';
      }

      if (status.unstaged.length > 0) {
        statusOutput += `\n${chalk.yellow('📝 Unstaged changes:')}`;
        statusOutput += status.unstaged.map((file) => `\n  ${chalk.yellow('M')} ${file}`).join('');
        statusOutput += '\n';
      }

      if (status.untracked.length > 0) {
        statusOutput += `\n${chalk.red('❓ Untracked files:')}`;
        statusOutput += status.untracked.map((file) => `\n  ${chalk.red('??')} ${file}`).join('');
        statusOutput += '\n';
      }

      console.log(statusOutput);

      console.log(
        status.total === 0
          ? chalk.green('✨ Working directory is clean')
          : chalk.blue(`📊 Total changes: ${status.total}`)
      );

      // Show last commit
      const lastCommit = await this.gitService.getLastCommitMessage();
      if (lastCommit) {
        console.log(chalk.gray(`\n💬 Last commit: "${lastCommit}"`));
      }

      // Force exit to prevent delay
      exitProcess(0);
    } catch (error) {
      handleError(error);
    }
  };

  diff = async (): Promise<void> => {
    try {
      if (!(await this.gitService.isGitRepository())) {
        console.log(chalk.red('Not a git repository'));
        exitProcess(1);
        return;
      }

      const summary = await this.gitService.getChangesSummary();
      console.log(`${chalk.blue('📋 Changes Summary:')}

${summary}`);

      // Force exit to prevent delay
      exitProcess(0);
    } catch (error) {
      handleError(error);
    }
  };
}
