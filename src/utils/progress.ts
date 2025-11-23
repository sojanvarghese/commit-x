// Enhanced progress feedback system with detailed progress bars and ETA calculation

import { lightColors } from "./colors.js";

export interface ProgressOptions {
  title: string;
  total: number;
  showETA?: boolean;
  showPercentage?: boolean;
  showSpeed?: boolean;
  width?: number;
  format?: string;
}

export class ProgressTracker {
  private current = 0;
  private readonly total: number;
  private readonly title: string;
  private readonly startTime: number;
  private readonly showETA: boolean;
  private readonly showPercentage: boolean;
  private readonly showSpeed: boolean;
  private readonly width: number;
  private readonly format: string;
  private lastUpdateTime: number;
  private isComplete = false;

  constructor(options: ProgressOptions) {
    this.title = options.title;
    this.total = options.total;
    this.showETA = options.showETA ?? true;
    this.showPercentage = options.showPercentage ?? true;
    this.showSpeed = options.showSpeed ?? false;
    this.width = options.width ?? 30;
    this.format = options.format ?? "bar";
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
  }

  update(current: number, message?: string): void {
    if (this.isComplete) return;

    this.current = Math.min(current, this.total);
    this.lastUpdateTime = Date.now();

    this.render(message);

    if (this.current >= this.total) {
      this.complete();
    }
  }

  increment(amount = 1, message?: string): void {
    this.update(this.current + amount, message);
  }

  complete(message?: string): void {
    if (this.isComplete) return;

    this.current = this.total;
    this.isComplete = true;
    this.render(message);

    if (process.stdout.isTTY) {
      process.stdout.write("\n");
    }
  }

  fail(message?: string): void {
    if (process.stdout.isTTY) {
      // Clear current line
      process.stdout.write("\r\x1b[K");
    }

    console.error(
      lightColors.red(`❌ ${this.title}${message ? `: ${message}` : ""}`)
    );
  }

  private render(message?: string): void {
    if (!process.stdout.isTTY) {
      // Non-TTY output - just log milestones
      if (this.current % Math.ceil(this.total / 10) === 0 || this.isComplete) {
        const percent = Math.round((this.current / this.total) * 100);
        console.log(
          `${this.title}: ${percent}%${message ? ` - ${message}` : ""}`
        );
      }
      return;
    }

    const line = this.buildProgressLine(message);

    // Clear line and write progress
    process.stdout.write(`\r\x1b[K${line}`);
  }

  private buildProgressLine(message?: string): string {
    const percent = this.total > 0 ? this.current / this.total : 0;
    const percentText = Math.round(percent * 100);

    let line = "";

    // Title
    line += `${lightColors.cyan(this.title)} `;

    // Progress bar
    if (this.format === "bar") {
      line += this.buildProgressBar(percent);
    } else {
      line += this.buildSpinner();
    }

    // Percentage
    if (this.showPercentage) {
      line += ` ${percentText}%`;
    }

    // Count
    line += ` (${this.current}/${this.total})`;

    // ETA
    if (this.showETA && this.current > 0 && !this.isComplete) {
      const eta = this.calculateETA();
      if (eta) {
        line += ` ETA: ${eta}`;
      }
    }

    // Speed
    if (this.showSpeed && this.current > 0) {
      const speed = this.calculateSpeed();
      if (speed) {
        line += ` (${speed})`;
      }
    }

    // Current message
    if (message) {
      line += ` - ${lightColors.gray(message)}`;
    }

    return line;
  }

  private buildProgressBar(percent: number): string {
    const filledWidth = Math.round(this.width * percent);
    const emptyWidth = this.width - filledWidth;

    const filled = "█".repeat(filledWidth);
    const empty = "░".repeat(emptyWidth);

    const color = this.isComplete
      ? lightColors.green
      : percent > 0.7
        ? lightColors.cyan
        : lightColors.yellow;

    return `[${color(filled)}${lightColors.dim(empty)}]`;
  }

  private buildSpinner(): string {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const frame = frames[Math.floor(Date.now() / 80) % frames.length];
    return lightColors.cyan(frame);
  }

  private calculateETA(): string | null {
    if (this.current === 0 || this.isComplete) return null;

    const elapsed = Date.now() - this.startTime;
    const rate = this.current / elapsed; // items per ms
    const remaining = this.total - this.current;
    const etaMs = remaining / rate;

    return this.formatDuration(etaMs);
  }

  private calculateSpeed(): string | null {
    if (this.current === 0) return null;

    const elapsed = (Date.now() - this.startTime) / 1000; // seconds
    const rate = this.current / elapsed;

    if (rate < 1) {
      return `${(elapsed / this.current).toFixed(1)}s/item`;
    } else {
      return `${rate.toFixed(1)} items/s`;
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }
}

/**
 * Multi-step progress tracker for complex operations
 */
export class MultiStepProgress {
  private steps: Array<{ name: string; weight: number; completed: boolean }> =
    [];
  private currentStep = 0;
  private currentStepProgress = 0;
  private tracker?: ProgressTracker;

  constructor(private title: string) {}

  addStep(name: string, weight = 1): this {
    this.steps.push({ name, weight, completed: false });
    return this;
  }

  start(): this {
    const totalWeight = this.steps.reduce((sum, step) => sum + step.weight, 0);
    this.tracker = new ProgressTracker({
      title: this.title,
      total: totalWeight * 100, // Use 100 as multiplier for smooth progress
      showETA: true,
      showPercentage: true,
    });

    this.updateProgress();
    return this;
  }

  updateStep(progress: number, message?: string): void {
    if (this.currentStep >= this.steps.length) return;

    this.currentStepProgress = Math.min(progress, 100);
    const stepName = this.steps[this.currentStep].name;
    const displayMessage = message ? `${stepName}: ${message}` : stepName;

    this.updateProgress(displayMessage);
  }

  nextStep(message?: string): void {
    if (this.currentStep < this.steps.length) {
      this.steps[this.currentStep].completed = true;
    }

    this.currentStep++;
    this.currentStepProgress = 0;

    if (this.currentStep < this.steps.length) {
      const stepName = this.steps[this.currentStep].name;
      const displayMessage = message ? `${stepName}: ${message}` : stepName;
      this.updateProgress(displayMessage);
    } else {
      this.complete();
    }
  }

  complete(message?: string): void {
    this.tracker?.complete(message || "All steps completed");
  }

  fail(message?: string): void {
    this.tracker?.fail(message);
  }

  private updateProgress(message?: string): void {
    if (!this.tracker) return;

    let totalProgress = 0;

    // Add completed steps
    for (let i = 0; i < this.currentStep; i++) {
      totalProgress += this.steps[i].weight * 100;
    }

    // Add current step progress
    if (this.currentStep < this.steps.length) {
      const currentWeight = this.steps[this.currentStep].weight;
      totalProgress += currentWeight * this.currentStepProgress;
    }

    this.tracker.update(Math.round(totalProgress), message);
  }
}

/**
 * Simple progress utilities
 */
export const createProgress = (options: ProgressOptions): ProgressTracker => {
  return new ProgressTracker(options);
};

export const createMultiStepProgress = (title: string): MultiStepProgress => {
  return new MultiStepProgress(title);
};
