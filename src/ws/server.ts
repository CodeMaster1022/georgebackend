import type { Server as HttpServer } from "http";
import { parse as parseUrl } from "url";
import jwt from "jsonwebtoken";
import { WebSocketServer, type WebSocket } from "ws";
import { env } from "../config/env";
import type { UserRole } from "../models/User";

const WS_PATH = "/ws";

/** userId -> set of WebSocket connections (multiple tabs/devices) */
const connectionsByUserId = new Map<string, Set<WebSocket>>();

function getTokenFromRequest(url: string): string | null {
  const parsed = parseUrl(url, true);
  const token = parsed.query?.token;
  return typeof token === "string" ? token : null;
}

function verifyToken(token: string): { userId: string; role: UserRole; email: string } | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { sub?: string; role?: UserRole; email?: string };
    const userId = String(decoded?.sub || "");
    const role = decoded?.role;
    const email = String(decoded?.email || "");
    if (!userId || !role || !email) return null;
    return { userId, role, email };
  } catch {
    return null;
  }
}

function addConnection(userId: string, ws: WebSocket): void {
  let set = connectionsByUserId.get(userId);
  if (!set) {
    set = new Set();
    connectionsByUserId.set(userId, set);
  }
  set.add(ws);
}

function removeConnection(userId: string, ws: WebSocket): void {
  const set = connectionsByUserId.get(userId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) connectionsByUserId.delete(userId);
  }
}

export function getConnectionsByUserId(): Map<string, Set<WebSocket>> {
  return connectionsByUserId;
}

export function attachWsToServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = request.url || "";
    if (!url.startsWith(WS_PATH)) {
      socket.destroy();
      return;
    }
    const token = getTokenFromRequest(url);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const user = verifyToken(token);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, user);
    });
  });

  wss.on("connection", (ws: WebSocket, _request: unknown, user: { userId: string; role: UserRole; email: string }) => {
    const userId = user.userId;
    addConnection(userId, ws);
    // eslint-disable-next-line no-console
    console.log("[ws] client connected", { userId, role: user.role });

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30000);

    ws.on("close", () => {
      clearInterval(pingInterval);
      removeConnection(userId, ws);
    });
    ws.on("error", () => {
      clearInterval(pingInterval);
      removeConnection(userId, ws);
    });
  });
}
