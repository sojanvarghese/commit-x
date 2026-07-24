export class InFlightRequestDeduplicator {
  private readonly pendingRequests = new Map<string, Promise<unknown>>();

  async run<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    const existing = this.pendingRequests.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async (): Promise<T> => {
      try {
        return await requestFn();
      } finally {
        this.pendingRequests.delete(key);
      }
    })();

    this.pendingRequests.set(key, promise);
    return promise;
  }
}

export interface ChunkOptions<T> {
  maxItems: number;
  maxBudget: number;
  sizeOf(item: T): number;
}

export const chunkByBudget = <T>(
  items: readonly T[],
  options: ChunkOptions<T>
): T[][] => {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBudget = 0;

  for (const item of items) {
    const itemBudget = Math.max(1, options.sizeOf(item));
    if (
      current.length > 0 &&
      (current.length >= options.maxItems ||
        currentBudget + itemBudget > options.maxBudget)
    ) {
      chunks.push(current);
      current = [];
      currentBudget = 0;
    }
    current.push(item);
    currentBudget += itemBudget;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
};

export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex++;
      const item = items[itemIndex];
      if (item === undefined) break;
      results[itemIndex] = await worker(item, itemIndex);
    }
  });

  await Promise.all(runners);
  return results;
};
