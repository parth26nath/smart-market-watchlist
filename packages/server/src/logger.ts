// Hand-rolled structured logger — the ask is "structured logging," not a
// production log pipeline, so this is ~20 lines instead of a dependency
// (DECISIONS.md §7). Every ingestion and alerting decision logs through here
// so behaviour is explainable after the fact from stdout alone.

type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, event: string, context: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, context?: Record<string, unknown>) => log("debug", event, context),
  info: (event: string, context?: Record<string, unknown>) => log("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => log("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => log("error", event, context),
};
