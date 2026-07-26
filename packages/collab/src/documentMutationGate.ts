export type DocumentMutationGate = {
  isRestMutationActive(documentName: string): boolean;
  runRestMutation<T>(documentName: string, task: () => Promise<T>): Promise<T>;
};

/**
 * Fences live Yjs writes while a REST content mutation owns a document.
 *
 * REST commands enter this gate only after the document-content lock has
 * drained. Live writes are synchronous at Hocuspocus's apply boundary, so
 * they cannot wait there; they are rejected and the client reconnects to the
 * REST command's committed document instead.
 */
export function createDocumentMutationGate(): DocumentMutationGate {
  const activeRestMutations = new Set<string>();

  return {
    isRestMutationActive: (documentName) => activeRestMutations.has(documentName),
    async runRestMutation<T>(documentName: string, task: () => Promise<T>): Promise<T> {
      if (activeRestMutations.has(documentName)) {
        throw new Error(`REST content mutation is already active for ${documentName}`);
      }
      activeRestMutations.add(documentName);
      try {
        return await task();
      } finally {
        activeRestMutations.delete(documentName);
      }
    },
  };
}
