// In-flight request deduplicator: concurrent calls with the same key share a
// single underlying promise. Each call site picks its own result type; internal
// storage uses `unknown` to avoid lying about the shape.
export class RequestBatcher {
  private readonly pendingRequests = new Map<string, Promise<unknown>>();

  async batch<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
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
