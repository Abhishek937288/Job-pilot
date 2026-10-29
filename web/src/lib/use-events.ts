"use client";

import type { ServerEvent } from "@jobpilot/shared";
import { useEffect, useEffectEvent, useState } from "react";

export type EventsState = "connecting" | "open" | "reconnecting";

/**
 * Subscribes to `GET /api/events` (SSE) while mounted. `onOpen` runs on every (re)connect, since
 * events are not replayed and the caller must reload what it shows.
 */
export function useServerEvents(
  enabled: boolean,
  onEvent: (event: ServerEvent) => void,
  onOpen: (isReconnect: boolean) => void,
): EventsState {
  const [state, setState] = useState<EventsState>("connecting");
  const handleEvent = useEffectEvent(onEvent);
  const handleOpen = useEffectEvent(onOpen);

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let opened = false;
    let disposed = false;

    const connect = () => {
      source = new EventSource("/api/events", { withCredentials: true });
      source.onopen = () => {
        attempts = 0;
        setState("open");
        handleOpen(opened);
        opened = true;
      };
      source.onmessage = (msg: MessageEvent<string>) => {
        try {
          handleEvent(JSON.parse(msg.data) as ServerEvent);
        } catch {
          // ignore malformed messages
        }
      };
      source.onerror = () => {
        if (disposed || !source) return;
        setState("reconnecting");
        // The browser retries network drops itself; it gives up (CLOSED) on HTTP errors.
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          const delay = Math.min(30_000, 1000 * 2 ** attempts++);
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [enabled]);

  return enabled ? state : "connecting";
}
