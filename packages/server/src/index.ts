import { createApp } from "./api/app.js";
import { createProvider } from "./providers/index.js";
import { SystemClock } from "./domain/clock.js";
import { IngestionScheduler } from "./ingestion/scheduler.js";
import { logger } from "./logger.js";

const clock = new SystemClock();
const provider = createProvider(process.env, clock);
logger.info("startup.provider_selected", { provider: provider.name });

const scheduler = new IngestionScheduler(provider, clock);
scheduler.start();

const app = createApp();
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  logger.info("startup.server_listening", { port });
});

process.on("SIGTERM", () => {
  scheduler.stop();
  process.exit(0);
});
