import { Types } from "mongoose";
import { getConnectionsByUserId } from "./server";
import { TeacherProfileModel } from "../models/TeacherProfile";
import { TeachingNotificationModel } from "../models/TeachingNotification";

/**
 * Resolve teacher's User id from TeacherProfile id (for targeting notifications).
 */
export async function resolveTeacherUserId(teacherProfileId: string | Types.ObjectId): Promise<string | null> {
  const id = typeof teacherProfileId === "string" ? teacherProfileId : String(teacherProfileId);
  if (!Types.ObjectId.isValid(id)) return null;
  const profile = (await TeacherProfileModel.findById(id).select("userId").lean()) as { userId?: Types.ObjectId } | null;
  return profile?.userId ? String(profile.userId) : null;
}

/**
 * Send a notification event to the given user ids (all their connected clients).
 */
export function notifyUsers(userIds: string[], event: string, payload: Record<string, unknown>): void {
  const conns = getConnectionsByUserId();
  const message = JSON.stringify({ type: event, ...payload });
  for (const userId of userIds) {
    if (!userId) continue;
    const set = conns.get(userId);
    const count = set ? Array.from(set).filter((ws) => ws.readyState === 1).length : 0;
    // eslint-disable-next-line no-console
    console.log("[notifications] emit", { event, userId, connections: count });
    if (set) {
      for (const ws of set) {
        if (ws.readyState === 1) {
          ws.send(message);
        }
      }
    }
  }
}

/**
 * Persist a teaching notification for each user and send over WebSocket.
 */
export async function persistAndNotify(
  userIds: string[],
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  for (const userId of userIds) {
    if (!userId || !Types.ObjectId.isValid(userId)) continue;
    try {
      await TeachingNotificationModel.create({
        userId: new Types.ObjectId(userId),
        type: event,
        payload,
        readAt: null,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[TeachingNotification] create failed", e);
    }
  }
  notifyUsers(userIds, event, payload);
}
