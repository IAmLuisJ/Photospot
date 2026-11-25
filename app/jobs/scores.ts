import { COUNTER_COLUMNS, toCounters, type CounterRow } from "../data/scores";
import { computeScore } from "../domain/scoring/score";
import { hotContribution, HOT_WINDOW_DAYS } from "../domain/scoring/hot";
import { DEFAULT_WEIGHTS, type ScoreWeights } from "../domain/scoring/weights";
import { weightForSignalKind } from "../domain/scoring/signal-weight";

const SPOT_PAGE_SIZE = 50;
const EVENT_PAGE_SIZE = 1000;

export async function backfillScores(
  db: D1Database,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Promise<number> {
  let cursor = "";
  let updated = 0;
  const columns = COUNTER_COLUMNS.split(",") as (keyof CounterRow)[];
  while (true) {
    const { results } = await db
      .prepare(
        `SELECT id,${COUNTER_COLUMNS} FROM spots WHERE id>? ORDER BY id LIMIT ?`,
      )
      .bind(cursor, SPOT_PAGE_SIZE)
      .all<CounterRow & { id: string }>();
    if (!results.length) break;
    const writes = await db.batch(
      results.map((row) =>
        db
          .prepare(
            `UPDATE spots SET score=? WHERE id=? AND ${columns.map((c) => `${c}=?`).join(" AND ")}`,
          )
          .bind(
            computeScore(toCounters(row), weights),
            row.id,
            ...columns.map((c) => row[c]),
          ),
      ),
    );
    updated += writes.reduce(
      (n, result) => n + Number(result.meta.changes > 0),
      0,
    );
    cursor = results[results.length - 1].id;
  }
  return updated;
}

export async function refreshHotScores(
  db: D1Database,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  now = new Date(),
): Promise<number> {
  const since = new Date(
    now.getTime() - HOT_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  let cursor = "";
  let updated = 0;
  while (true) {
    const { results: spots } = await db
      .prepare("SELECT id FROM spots WHERE id>? ORDER BY id LIMIT ?")
      .bind(cursor, SPOT_PAGE_SIZE)
      .all<{ id: string }>();
    if (!spots.length) break;
    const totals = new Map(spots.map(({ id }) => [id, 0]));
    for (const table of ["signals", "comments", "photos"] as const) {
      let dateCursor = since;
      let idCursor = "";
      const extra =
        table === "signals" ? ",kind,value" : table === "photos" ? ",kind" : "";
      const visibility = table === "signals" ? "" : " AND status='published'";
      while (true) {
        const { results } = await db
          .prepare(
            `SELECT id,spot_id,created_at${extra} FROM ${table}
          WHERE spot_id IN (${spots.map(() => "?").join(",")}) AND created_at>=?
          AND (created_at>? OR (created_at=? AND id>?))${visibility} ORDER BY created_at,id LIMIT ?`,
          )
          .bind(
            ...spots.map((s) => s.id),
            since,
            dateCursor,
            dateCursor,
            idCursor,
            EVENT_PAGE_SIZE,
          )
          .all<{
            id: string;
            spot_id: string;
            created_at: string;
            kind?: string;
            value?: number;
          }>();
        if (!results.length) break;
        for (const event of results) {
          const signal =
            table === "comments"
              ? { kind: "comment" as const }
              : table === "photos"
                ? {
                    kind: "photo" as const,
                    photoKind:
                      event.kind === "session"
                        ? ("session" as const)
                        : ("scouting" as const),
                  }
                : event.kind === "shoot_again"
                  ? {
                      kind: "shoot_again" as const,
                      value: event.value === 1 ? (1 as const) : (0 as const),
                    }
                  : { kind: "shoot_type_upvote" as const };
          totals.set(
            event.spot_id,
            (totals.get(event.spot_id) ?? 0) +
              hotContribution(
                {
                  weight: weightForSignalKind(signal, weights),
                  occurredAt: new Date(event.created_at),
                },
                now,
              ),
          );
        }
        const last = results[results.length - 1];
        dateCursor = last.created_at;
        idCursor = last.id;
      }
    }
    await db.batch(
      spots.map(({ id }) =>
        db
          .prepare("UPDATE spots SET hot_score=? WHERE id=?")
          .bind(Math.round((totals.get(id) ?? 0) * 1000) / 1000, id),
      ),
    );
    updated += spots.length;
    cursor = spots[spots.length - 1].id;
  }
  return updated;
}
