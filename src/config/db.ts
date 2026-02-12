import mongoose from "mongoose";
import { env } from "./env";

let connectPromise: Promise<typeof mongoose> | null = null;

export async function connectDb() {
  mongoose.set("strictQuery", true);
  // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (mongoose.connection.readyState === 1) return;

  if (!connectPromise) {
    connectPromise = mongoose.connect(env.MONGO_URI).catch((err) => {
      connectPromise = null;
      throw err;
    });
  }

  await connectPromise;
}

