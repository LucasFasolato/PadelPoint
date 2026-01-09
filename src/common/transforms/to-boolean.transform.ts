export function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }

  return undefined;
}
