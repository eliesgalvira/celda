import { componentsGeneric } from "convex/server";

export type Components = {
  "rateLimiter": import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};

export const components: Components = componentsGeneric() as any;
