import { sql } from 'drizzle-orm';

/**
 * These expressions require the surrounding query to alias pages as `p` and
 * folders as `f`. Deleted hierarchies can lack a root closure row, so retain
 * the direct-parent owner fallback before falling back to the entity creator.
 */
export const deletedPageOwnerSql = sql`coalesce(
  (
    select root.created_by
    from folder_closure fc
    join folders root on root.id = fc.ancestor_id
    where fc.descendant_id = p.parent_id
      and root.parent_id is null
    order by fc.depth desc
    limit 1
  ),
  (
    select parent.created_by
    from folders parent
    where parent.id = p.parent_id
  ),
  p.created_by
)`;

export const deletedFolderOwnerSql = sql`coalesce(
  (
    select root.created_by
    from folder_closure fc
    join folders root on root.id = fc.ancestor_id
    where fc.descendant_id = f.id
      and root.parent_id is null
    order by fc.depth desc
    limit 1
  ),
  (
    select parent.created_by
    from folders parent
    where parent.id = f.parent_id
  ),
  f.created_by
)`;
