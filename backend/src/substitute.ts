import type { TestDef } from "./tags.ts";
import { API_BASE_URL } from "./config.ts";

export function substituteString(
  template: string,
  vars: Record<string, unknown>,
): string {
  return template.replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, (_, key: string) => {
    if (key === "BASE_URL") return API_BASE_URL;
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export function substituteValue<T>(value: T, vars: Record<string, unknown>): T {
  if (typeof value === "string") {
    return substituteString(value, vars) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteValue(v, vars)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteValue(v, vars);
    }
    return out as T;
  }
  return value;
}

export function substituteTestDef(
  def: TestDef,
  vars: Record<string, unknown>,
): TestDef {
  return substituteValue(structuredClone(def), vars);
}
