import { useEffect, useRef, useState } from "react";
import { emptyViewState, type LiveMessage, type ViewState } from "@smartcampus/faculty-local";

const RECONNECT_MS = 1_000;

/**
 * The state the local agent pushes over `ws://localhost/live`. The page only listens: it never sends anything, holds
 * no key and does not know the server's address. When the agent restarts the last state stays on screen.
 */
export function useLive(onAudio: (m: Extract<LiveMessage, { type: "audio" }>) => void): { state: ViewState; connected: boolean } {
  const [state, setState] = useState<ViewState>(emptyViewState);
  const [connected, setConnected] = useState(false);
  const audio = useRef(onAudio);
  audio.current = onAudio;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const open = () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${location.host}/live`);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as LiveMessage;
          if (message.type === "state") setState(message.state);
          else if (message.type === "audio") audio.current(message);
        } catch {
          // a message that does not parse is ignored: the page keeps what it has
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(open, RECONNECT_MS);
      };
    };
    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  return { state, connected };
}
