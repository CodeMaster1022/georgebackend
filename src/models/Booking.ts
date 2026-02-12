import mongoose, { Schema, type InferSchemaType } from "mongoose";

export type BookingStatus = "booked" | "completed" | "cancelled" | "no_show";

const BookingSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "ClassSession", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "TeacherProfile", required: true },
    studentUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["booked", "completed", "cancelled", "no_show"], default: "booked", required: true },
    priceCredits: { type: Number, required: true, min: 1 },
    creditTxId: { type: Schema.Types.ObjectId, ref: "CreditTransaction" },
    calendarEventId: { type: String, trim: true, default: "" },
    bookedAt: { type: Date, required: true, default: () => new Date() },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

BookingSchema.index({ sessionId: 1 }, { unique: true });
BookingSchema.index({ studentUserId: 1, bookedAt: -1 });
BookingSchema.index({ teacherId: 1, bookedAt: -1 });

export type Booking = InferSchemaType<typeof BookingSchema>;

export const BookingModel = mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

