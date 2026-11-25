/** Cleanup claims receipts before R2 deletion, preventing attachment races. */
export async function sweepUploads(
  db: D1Database,
  bucket: Pick<R2Bucket, "delete">,
  now = new Date(),
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT storage_path FROM uploads WHERE attached_at IS NULL
    AND (state='deleting' OR expires_at<=?) ORDER BY expires_at,storage_path LIMIT 100`,
    )
    .bind(now.toISOString())
    .all<{ storage_path: string }>();
  if (!results.length) return 0;
  const claims = await db.batch(
    results.map(({ storage_path }) =>
      db
        .prepare(
          `UPDATE uploads SET state='deleting'
    WHERE storage_path=? AND attached_at IS NULL AND (state='deleting' OR expires_at<=?)`,
        )
        .bind(storage_path, now.toISOString()),
    ),
  );
  const keys = results
    .filter((_, index) => claims[index].meta.changes > 0)
    .map((r) => r.storage_path);
  if (!keys.length) return 0;
  await bucket.delete(keys);
  await db
    .prepare(
      `DELETE FROM uploads WHERE attached_at IS NULL AND state='deleting' AND storage_path IN (${keys.map(() => "?").join(",")})`,
    )
    .bind(...keys)
    .run();
  return keys.length;
}
