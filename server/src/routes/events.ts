import { Router } from "express";
import { logger } from "../lib/logger.js";
import { currentUser } from "../middleware/auth.js";
import { eventHub } from "../queue/events.js";

/**
 * Server-Sent Events, authenticated at connect. The connection only ever receives the signed-in user's
 * own channel (`user:{id}`), so results are never broadcast.
 */
export const eventsRouter = Router();

eventsRouter.get("/", async (req, res) => {
  const userId = String(currentUser(req)._id);
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n: connected\n\n");

  const unsubscribe = await eventHub.subscribe(userId, (payload) => res.write(`data: ${payload}\n\n`));
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe().catch((err) => logger.warn({ err }, "unsubscribe failed"));
  });
});
