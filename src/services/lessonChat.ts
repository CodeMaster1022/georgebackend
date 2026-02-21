import { Types } from "mongoose";
import { BookingModel } from "../models/Booking";
import { resolveTeacherUserId } from "../ws/emit";

export type LessonChatParticipant =
  | { allowed: true; otherUserId: string; myRole: "student" | "teacher" }
  | { allowed: false };

/**
 * Check if the current user is a participant of this booking (student or teacher).
 * Returns otherUserId so the caller can send WebSocket notification.
 */
export async function getBookingChatParticipant(
  bookingId: Types.ObjectId,
  currentUserId: string
): Promise<LessonChatParticipant> {
  const booking = await BookingModel.findById(bookingId).select("studentUserId teacherId").lean();
  if (!booking || Array.isArray(booking)) return { allowed: false };
  const b = booking as { studentUserId: Types.ObjectId; teacherId: Types.ObjectId };
  const studentUserId = String(b.studentUserId);
  const teacherUserId = await resolveTeacherUserId(b.teacherId);
  if (currentUserId === studentUserId) {
    return { allowed: true, otherUserId: teacherUserId ?? "", myRole: "student" };
  }
  if (teacherUserId && currentUserId === teacherUserId) {
    return { allowed: true, otherUserId: studentUserId, myRole: "teacher" };
  }
  return { allowed: false };
}
