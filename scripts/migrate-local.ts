import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import config, { LOCAL_D1_ID } from "../cloudflare.config";

// Always local. Use the exact binding identity the app and seed scripts use.
const cli = fileURLToPath(
  new URL("./bin/cf", import.meta.resolve("cf/package.json")),
);
const result = spawnSync(
  process.execPath,
  [
    cli,
    "d1",
    "migrations",
    "apply",
    config.worker.env.DB.id ?? LOCAL_D1_ID,
    "--local",
    "--dir",
    "migrations",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
