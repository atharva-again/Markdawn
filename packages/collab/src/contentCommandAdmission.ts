export type ContentCommandAdmission = {
  tryAcquire(documentName: string): (() => void) | null;
};

export function createContentCommandAdmission(options: {
  maxConcurrent: number;
  maxPerDocument: number;
}): ContentCommandAdmission {
  if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
    throw new Error('maxConcurrent must be a positive integer');
  }
  if (!Number.isInteger(options.maxPerDocument) || options.maxPerDocument < 1) {
    throw new Error('maxPerDocument must be a positive integer');
  }
  if (options.maxPerDocument > options.maxConcurrent) {
    throw new Error('maxPerDocument must not exceed maxConcurrent');
  }

  let concurrent = 0;
  const perDocument = new Map<string, number>();

  return {
    tryAcquire(documentName) {
      const documentCount = perDocument.get(documentName) ?? 0;
      if (concurrent >= options.maxConcurrent || documentCount >= options.maxPerDocument) {
        return null;
      }
      concurrent += 1;
      perDocument.set(documentName, documentCount + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        concurrent -= 1;
        const remaining = (perDocument.get(documentName) ?? 1) - 1;
        if (remaining === 0) perDocument.delete(documentName);
        else perDocument.set(documentName, remaining);
      };
    },
  };
}
