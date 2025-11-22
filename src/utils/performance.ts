// Performance monitoring and optimization utilities

import { PERFORMANCE_FLAGS } from "../constants/performance.js";

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private readonly startTimes = new Map<string, number>();
  private readonly metrics = new Map<string, { count: number; totalTime: number; avgTime: number }>();

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  public startTimer(operation: string): void {
    this.startTimes.set(operation, performance.now());
  }

  public endTimer(operation: string): number {
    const startTime = this.startTimes.get(operation);
    if (!startTime) {
      console.warn(`No start time found for operation: ${operation}`);
      return 0;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Update metrics
      const existing = this.metrics.get(operation) ?? { count: 0, totalTime: 0, avgTime: 0 };
    existing.count++;
    existing.totalTime += duration;
    existing.avgTime = existing.totalTime / existing.count;
    this.metrics.set(operation, existing);

    this.startTimes.delete(operation);
    return duration;
  }

  public getMetrics(): Map<string, { count: number; totalTime: number; avgTime: number }> {
    return new Map(this.metrics);
  }

  public getOperationTime(operation: string): number | undefined {
    return this.metrics.get(operation)?.avgTime;
  }

  public logMetrics(): void {
    // Performance monitoring disabled (development mode removed)
  }

  public clear(): void {
    this.startTimes.clear();
    this.metrics.clear();
  }
}

// Wrapper for timing async operations
export const withPerformanceTracking = async <T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> => {
  const monitor = PerformanceMonitor.getInstance();
  monitor.startTimer(operation);
  try {
    const result = await fn();
    const duration = monitor.endTimer(operation);

    // Log slow operations if monitoring enabled
    if (PERFORMANCE_FLAGS.ENABLE_PERFORMANCE_MONITORING && duration > 1000) {
      console.warn(`⚠️  Slow operation detected: ${operation} took ${duration.toFixed(2)}ms`);
    }

    return result;
  } catch (error) {
    monitor.endTimer(operation);
    throw error;
  }
};
