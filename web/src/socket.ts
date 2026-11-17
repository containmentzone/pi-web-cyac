import type { ClientMsg, ServerMsg } from "../../shared/protocol";
import { handleServerMessage, pushError, threadFromHash, useStore } from "./store";

let ws: WebSocket | null = null;
let retry = 0;
let subscribed: string | null = null;
const outbox: ClientMsg[] = [];

export function send(msg: ClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else if (msg.type !== "subscribe" && msg.type !== "unsubscribe") outbox.push(msg);
}

function syncSubscription(): void {
  const current = useStore.getState().current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (subscribed && subscribed !== current) send({ type: "unsubscribe", threadId: subscribed });
  if (current && subscribed !== current) send({ type: "subscribe", threadId: current });
  subscribed = current;
}

function open(): void {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const sock = new WebSocket(`${proto}//${window.location.host}/ws`);
  ws = sock;

  sock.onopen = () => {
    retry = 0;
    subscribed = null;
    useStore.setState({ connected: true, everConnected: true });
    syncSubscription();
    while (outbox.length) sock.send(JSON.stringify(outbox.shift()));
  };
  sock.onmessage = (ev) => {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type === "error" && msg.threadId && msg.threadId === useStore.getState().current && /Unknown thread/.test(msg.message)) {
      pushError("That thread no longer exists.");
      window.location.hash = "#/";
      return;
    }
    handleServerMessage(msg);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    subscribed = null;
    useStore.setState({ connected: false });
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(open, delay);
  };
}

export function connect(): void {
  const onHash = () => useStore.setState({ current: threadFromHash() });
  window.addEventListener("hashchange", onHash);
  onHash();
  useStore.subscribe((st, prev) => {
    if (st.current !== prev.current) syncSubscription();
  });
  open();
}
