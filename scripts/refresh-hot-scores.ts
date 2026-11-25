import { refreshHotScores } from "../app/jobs/scores";
import { createLocalResources, isMain } from "./local-resources";
export { refreshHotScores };
if (isMain(import.meta.url)) {
  const local = await createLocalResources();
  try {
    console.log(`Refreshed ${await refreshHotScores(local.db)} hot scores.`);
  } finally {
    await local.close();
  }
}
