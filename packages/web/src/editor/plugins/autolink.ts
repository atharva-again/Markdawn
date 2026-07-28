import type { Ctx } from '@milkdown/kit/ctx';
import { linkSchema } from '@milkdown/preset-commonmark';
import { $prose } from '@milkdown/utils';
import { createAutolinkPastePlugin } from './autolinkPaste';
import { autolinkTyping } from './autolinkTyping';

const extendLinkSchema = linkSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  inclusive: false,
}));

const autolinkPastePlugin = $prose((ctx: Ctx) => {
  const linkMarkType = linkSchema.type(ctx);
  return createAutolinkPastePlugin(linkMarkType);
});

export const autolink = [extendLinkSchema, autolinkPastePlugin, ...autolinkTyping].flat();
