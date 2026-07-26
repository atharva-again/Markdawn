export const validatePageProperties = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return 'properties must be an object or null';
  }

  if (Object.hasOwn(value, 'tags')) {
    const tags = (value as Record<string, unknown>).tags;
    if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
      return 'properties.tags must be an array of strings';
    }
  }

  return null;
};
