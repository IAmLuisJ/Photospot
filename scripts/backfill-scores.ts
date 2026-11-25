import { backfillScores } from "../app/jobs/scores";
import { createLocalResources, isMain } from "./local-resources";
export { backfillScores };
if (isMain(import.meta.url)) {
  const local = await createLocalResources();
  try {
    console.log(`Backfilled ${await backfillScores(local.db)} spots.`);
  } finally {
    await local.close();
  }
}
