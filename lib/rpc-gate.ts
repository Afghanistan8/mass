// A small, dependency-free gate for public-RPC reads.
//
// Why it exists: Studionet's RPC limits `gen_call` to 30 requests/minute per IP, and its 429 responses
// carry no CORS headers, so a browser reports them as an opaque "Failed to fetch". Without a gate, page
// polling plus naive retries (each retry is another counted request) exhaust the budget and break pages.
//
// The gate: caches results, de-duplicates identical in-flight reads, spends from a request budget that
// is shared across browser tabs, and backs off (without amplifying load) when a failure looks like rate
// limiting. Written with erasable TypeScript only so it can be unit-tested directly by `node --test`.

export type WindowStore = { load(): number[]; save(timestamps: number[]): void };
export type CacheStore = {
  get(key: string): { t: number; v: unknown } | undefined;
  set(key: string, entry: { t: number; v: unknown }): void;
  clear(): void;
};

export type GateState = { phase: "ok" | "paced" | "cooldown"; until: number };

export type GateOptions = {
  budget: number; // max counted requests per window
  windowMs: number;
  maxConcurrent: number;
  ttlFinalMs: number;
  ttlPendingMs: number;
  cooldownMs: number; // base backoff after a rate-limit-like failure
  maxAttempts: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  windowStore?: WindowStore;
  cacheStore?: CacheStore;
  isRateLimitLike?: (error: unknown) => boolean;
};

export class RpcRateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcRateLimitedError";
  }
}

export const DEFAULT_RATE_LIMIT_MESSAGE =
  "Studionet limits public reads to 30 per minute per network address, and this browser has used its share. Mass is pacing requests; wait a few seconds and the data will load.";

const looksRateLimited = (error: unknown): boolean => {
  if (error instanceof RpcRateLimitedError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  // A browser cannot read a CORS-less 429, so a bare network failure is treated as a possible rate limit.
  return error instanceof TypeError || /failed to fetch|rate limit|too many|429|network/i.test(message);
};

export function createRpcGate(options: GateOptions) {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const isRateLimitLike = options.isRateLimitLike ?? looksRateLimited;

  let memoryWindow: number[] = [];
  const windowStore: WindowStore = options.windowStore ?? {
    load: () => memoryWindow,
    save: (timestamps) => { memoryWindow = timestamps; },
  };
  const memoryCache = new Map<string, { t: number; v: unknown }>();
  const cacheStore: CacheStore = options.cacheStore ?? {
    get: (key) => memoryCache.get(key),
    set: (key, entry) => { memoryCache.set(key, entry); },
    clear: () => memoryCache.clear(),
  };

  const inflight = new Map<string, Promise<unknown>>();
  const listeners = new Set<(state: GateState) => void>();
  let state: GateState = { phase: "ok", until: 0 };
  let cooldownUntil = 0;
  let slotChain: Promise<void> = Promise.resolve();
  let active = 0;
  const waiters: Array<() => void> = [];

  const setState = (next: GateState) => {
    if (next.phase === state.phase && next.until === state.until) return;
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  // Slot acquisition is serialised so concurrent callers can never overspend the shared budget.
  const acquireSlot = (): Promise<void> => {
    const run = slotChain.then(async () => {
      for (;;) {
        const t = now();
        if (cooldownUntil > t) {
          setState({ phase: "cooldown", until: cooldownUntil });
          await sleep(cooldownUntil - t + 10);
          continue;
        }
        const recent = windowStore.load().filter((stamp) => t - stamp < options.windowMs);
        if (recent.length < options.budget) {
          recent.push(t);
          windowStore.save(recent);
          setState({ phase: "ok", until: 0 });
          return;
        }
        const waitMs = recent[0] + options.windowMs - t + 25;
        setState({ phase: "paced", until: t + waitMs });
        await sleep(waitMs);
      }
    });
    slotChain = run.catch(() => undefined);
    return run;
  };

  const acquireConcurrency = async () => {
    if (active < options.maxConcurrent) { active += 1; return; }
    await new Promise<void>((resolve) => waiters.push(resolve));
    active += 1;
  };
  const releaseConcurrency = () => {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  };

  async function attempt<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let tries = 1; tries <= options.maxAttempts; tries += 1) {
      await acquireSlot();
      await acquireConcurrency();
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!isRateLimitLike(error)) throw error;
        // Back off for everyone: more requests right now would only deepen the limit.
        const backoff = options.cooldownMs * tries * (0.75 + random() * 0.5);
        cooldownUntil = Math.max(cooldownUntil, now() + backoff);
        setState({ phase: "cooldown", until: cooldownUntil });
      } finally {
        releaseConcurrency();
      }
    }
    throw new RpcRateLimitedError(
      lastError instanceof RpcRateLimitedError ? lastError.message : DEFAULT_RATE_LIMIT_MESSAGE,
    );
  }

  return {
    async run<T>(key: string, pending: boolean, fn: () => Promise<T>, opts: { fresh?: boolean } = {}): Promise<T> {
      const ttl = pending ? options.ttlPendingMs : options.ttlFinalMs;
      if (!opts.fresh) {
        const hit = cacheStore.get(key);
        if (hit && now() - hit.t < ttl) return hit.v as T;
        const flying = inflight.get(key);
        if (flying) return (await flying) as T;
      }
      const promise = attempt(fn).then((value) => {
        cacheStore.set(key, { t: now(), v: value });
        return value;
      });
      inflight.set(key, promise);
      try {
        return await promise;
      } finally {
        if (inflight.get(key) === promise) inflight.delete(key);
      }
    },
    clearCache() { cacheStore.clear(); },
    subscribe(listener: (s: GateState) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: () => state,
    // Test/diagnostic helpers.
    spent: () => windowStore.load().filter((stamp) => now() - stamp < options.windowMs).length,
  };
}
