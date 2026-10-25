import { createHmac, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { maximumRequestBytes, validateSnapshot } from "./snapshot.js";
import { createShareStorage } from "./storage.js";

const endpoint = "/api/playground/snippets";
const shareIDPattern = /^[A-Za-z0-9_-]{22}$/;

function clientAddress(context) {
  return (
    context.req.header("cf-connecting-ip") ??
    context.req.header("x-envoy-external-address") ??
    context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function rateKey(secret, address, action, period) {
  return `mcl-playground:${action}:${createHmac("sha256", secret).update(address).digest("hex")}:${period}`;
}

function statusFor(error) {
  if (error instanceof HTTPException) return error.status;
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600)
    return error.status;
  return 500;
}

export function createApp(storage, options = {}) {
  const app = new Hono();
  const secret = options.rateLimitSecret ?? process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_HMAC_SECRET is required");
  let activeUploads = 0;
  let activeReads = 0;

  app.use("*", async (context, next) => {
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Cache-Control", "no-store");
    context.header("Referrer-Policy", "no-referrer");
  });
  app.get("/healthz", (context) => context.text("ok"));

  app.post(endpoint, bodyLimit({ maxSize: maximumRequestBytes }), async (context) => {
    if (activeUploads >= 1) throw new HTTPException(503, { message: "Upload queue is full" });
    activeUploads += 1;
    try {
      if (!context.req.header("content-type")?.toLowerCase().includes("application/json"))
        throw new HTTPException(415, { message: "JSON is required" });
      const now = Date.now();
      const address = clientAddress(context);
      const postKey = rateKey(secret, address, "post", Math.floor(now / 3_600_000));
      if (!(await storage.allowRequest(postKey, 6, 2 * 60 * 60)))
        throw new HTTPException(429, { message: "Rate limit exceeded" });
      let body;
      try {
        body = await context.req.json();
      } catch {
        throw new HTTPException(400, { message: "Invalid JSON" });
      }
      let validated;
      try {
        validated = validateSnapshot(body);
      } catch {
        throw new HTTPException(400, { message: "Invalid shared project" });
      }
      const dailyKey = rateKey(secret, address, "bytes", Math.floor(now / 86_400_000));
      if (!(await storage.allowUploadBytes(dailyKey, validated.contentBytes)))
        throw new HTTPException(429, { message: "Daily upload limit exceeded" });
      return context.json(
        await storage.createShare({
          id: randomBytes(16).toString("base64url"),
          serialized: validated.serialized,
          contentBytes: validated.contentBytes,
        }),
        201,
      );
    } finally {
      activeUploads -= 1;
    }
  });

  app.get(`${endpoint}/:id`, async (context) => {
    if (activeReads >= 4) throw new HTTPException(503, { message: "Read queue is full" });
    activeReads += 1;
    try {
      const now = Date.now();
      const address = clientAddress(context);
      const key = rateKey(secret, address, "get", Math.floor(now / 60_000));
      if (!(await storage.allowRequest(key, 120, 120)))
        throw new HTTPException(429, { message: "Rate limit exceeded" });
      const id = context.req.param("id");
      if (!shareIDPattern.test(id)) throw new HTTPException(404, { message: "Not found" });
      const result = await storage.getShare(id);
      if (!result) throw new HTTPException(404, { message: "Not found" });
      context.header("X-MCL-Runtime-Version", result.runtimeVersion);
      return context.json(result.snapshot);
    } finally {
      activeReads -= 1;
    }
  });

  app.notFound((context) => context.json({ error: "Not found" }, 404));
  app.onError((error, context) => {
    const status = statusFor(error);
    const messages = {
      400: "Invalid shared project",
      413: "Shared project is too large",
      415: "JSON is required",
      429: "Rate limit exceeded",
      404: "Not found",
      503: "Shared project service is busy",
      507: "Share storage is full",
    };
    return context.json(
      { error: messages[status] ?? "Shared project service is unavailable" },
      status,
    );
  });
  return app;
}

export async function startServer() {
  const storage = await createShareStorage();
  await storage.deleteExpiredShares();
  const app = createApp(storage);
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be a valid port number");
  const server = serve(
    { fetch: app.fetch, hostname: process.env.HOST ?? "0.0.0.0", port },
    ({ port: listeningPort }) =>
      process.stdout.write(`Playground share API listening on ${listeningPort}.\n`),
  );
  const cleanup = setInterval(
    () => {
      void storage.deleteExpiredShares().catch(() => {
        process.stderr.write("Unable to remove expired Playground shares.\n");
      });
    },
    30 * 60 * 1000,
  );
  cleanup.unref();
  async function close() {
    clearInterval(cleanup);
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await storage.close();
  }
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  return { app, close, server };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await startServer();
