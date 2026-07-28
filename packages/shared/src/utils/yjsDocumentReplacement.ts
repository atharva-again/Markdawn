import * as Y from 'yjs';
import { createYjsDocWithTitle } from './markdownToYjs.js';

function childSignature(child: Y.XmlElement | Y.XmlText): string {
  return child.toString();
}

/** Reconcile changed top-level blocks while preserving unrelated Yjs node identities. */
export function replaceMarkdownBody(
  document: Y.Doc,
  title: string,
  markdown: string,
  origin: unknown = 'markdawn-rest-edit',
): void {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, createYjsDocWithTitle(title, markdown));
    const current = document.getXmlFragment('prosemirror');
    const next = candidate.getXmlFragment('prosemirror');
    const currentChildren = current.toArray();
    const nextChildren = next.toArray();

    let prefix = 0;
    while (
      prefix < currentChildren.length &&
      prefix < nextChildren.length &&
      childSignature(currentChildren[prefix] as Y.XmlElement | Y.XmlText) ===
        childSignature(nextChildren[prefix] as Y.XmlElement | Y.XmlText)
    ) {
      prefix += 1;
    }

    let suffix = 0;
    while (
      suffix < currentChildren.length - prefix &&
      suffix < nextChildren.length - prefix &&
      childSignature(
        currentChildren[currentChildren.length - 1 - suffix] as Y.XmlElement | Y.XmlText,
      ) ===
        childSignature(nextChildren[nextChildren.length - 1 - suffix] as Y.XmlElement | Y.XmlText)
    ) {
      suffix += 1;
    }

    const deleteCount = currentChildren.length - prefix - suffix;
    const insertChildren = nextChildren
      .slice(prefix, nextChildren.length - suffix)
      .map((child) => child.clone() as Y.XmlElement | Y.XmlText);
    if (deleteCount === 0 && insertChildren.length === 0) return;
    document.transact(() => {
      if (deleteCount > 0) current.delete(prefix, deleteCount);
      if (insertChildren.length > 0) current.insert(prefix, insertChildren);
    }, origin);
  } finally {
    candidate.destroy();
  }
}
