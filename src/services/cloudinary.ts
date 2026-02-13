import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";

let configured = false;

export function getCloudinary() {
  if (!configured) {
    const cloudName = (env.CLOUDINARY_CLOUD_NAME || "").trim();
    const apiKey = (env.CLOUDINARY_API_KEY || "").trim();
    const apiSecret = (env.CLOUDINARY_API_SECRET || "").trim();
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.");
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

