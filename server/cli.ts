#!/usr/bin/env node
// Standalone entry: `pi-web` / `npm start` / the container image.
import { startServer } from "./app.js";

const server = await startServer();

let stopping = false;
const shutdown = async () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("[pi-web] shutting down");
  setTimeout(() => process.exit(0), 3000).unref();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
