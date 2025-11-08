export function encodeCursor(input: unknown): string {
  const json = JSON.stringify(input ?? {});
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor<T = unknown>(cursor?: string): T | undefined {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}
