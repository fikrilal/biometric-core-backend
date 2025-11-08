export interface Paginated<T> {
  items: T[];
  nextCursor?: string;
  limit?: number;
}

export function toPaginated<T>(
  items: T[],
  nextCursor?: string,
  limit?: number,
): Paginated<T> {
  const out: Paginated<T> = { items };
  if (nextCursor !== undefined) out.nextCursor = nextCursor;
  if (limit !== undefined) out.limit = limit;
  return out;
}

