export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;

      const exponential = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 200;
      const delay = exponential + jitter;

      console.warn(
        `[Retry] Intento ${attempt}/${maxAttempts} fallido. ` +
        `Reintentando en ${Math.round(delay)}ms...`
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}
