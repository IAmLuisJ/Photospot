import "../cloudflare.config";
import { LOCAL_D1_ID } from "../cloudflare.config";
import { isMain } from "./local-resources";

export function checkDeployConfiguration(
  env: Record<string, string | undefined>,
) {
  if (
    !env.D1_DATABASE_ID ||
    env.D1_DATABASE_ID === LOCAL_D1_ID ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(env.D1_DATABASE_ID)
  ) {
    throw new Error(
      "Set D1_DATABASE_ID to the production D1 database UUID before deploying.",
    );
  }
  const origin = new URL(env.AUTH_ORIGIN ?? "http://localhost");
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.AUTH_ORIGIN ||
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    origin.hostname.endsWith(".localhost")
  ) {
    throw new Error(
      "Set AUTH_ORIGIN to the exact public HTTPS origin before deploying.",
    );
  }
}
if (isMain(import.meta.url)) {
  checkDeployConfiguration(process.env);
  console.log("Production database and authentication origin are configured.");
}
