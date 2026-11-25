import { describe, expect, it } from "vitest";
import { checkDeployConfiguration } from "../../scripts/check-deploy";
import { LOCAL_D1_ID } from "../../cloudflare.config";

describe("deployment destination guard", () => {
  const database = "12345678-1234-4321-8765-123456789abc";
  it("refuses local or missing database destinations and localhost auth origins", () => {
    for (const id of [undefined, LOCAL_D1_ID, "photospots"]) {
      expect(() =>
        checkDeployConfiguration({
          D1_DATABASE_ID: id,
          AUTH_ORIGIN: "https://photos.example.com",
        }),
      ).toThrow(/database UUID/);
    }
    for (const origin of [
      undefined,
      "http://localhost:5173",
      "https://localhost",
      "http://photos.example.com",
      "https://photos.example.com/extra",
    ]) {
      expect(() =>
        checkDeployConfiguration({
          D1_DATABASE_ID: database,
          AUTH_ORIGIN: origin,
        }),
      ).toThrow(/HTTPS origin/);
    }
  });
  it("accepts a real database identifier and exact public HTTPS origin", () => {
    expect(() =>
      checkDeployConfiguration({
        D1_DATABASE_ID: database,
        AUTH_ORIGIN: "https://photos.example.com",
      }),
    ).not.toThrow();
  });
});
