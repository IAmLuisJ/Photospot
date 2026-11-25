import { createContext } from "react-router";
import type { AppRequestContext } from "./request-context.server";

export const runtimeContext = createContext<{
  env: Env;
  ctx: ExecutionContext;
}>();
export const appRequestContext =
  createContext<() => Promise<AppRequestContext>>();
