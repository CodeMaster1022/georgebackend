/**
 * Production entry point for Render/Railway (or any Node host).
 * Serves HTTP + WebSocket on the same port; real-time notifications require this server (not serverless).
 */
import http from "http";
import { env } from "./config/env";
import { createApp } from "./app";
import { attachWsToServer } from "./ws/server";

async function main() {
  const app = await createApp();
  const server = http.createServer(app);
  attachWsToServer(server);

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

