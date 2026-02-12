import dotenv from "dotenv";
import { z } from "zod";
import path from "path";

// Load .env file - try multiple paths for different environments
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
  // Also try loading from parent directory (for Vercel build)
  dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
}

const RawEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  // Support either name (your `.env` currently uses MONGODB_URI)
  MONGO_URI: z.string().min(1).optional(),
  MONGODB_URI: z.string().min(1).optional(),
  JWT_SECRET: z.string().optional(),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().int().positive().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Alternate mail env var names (supported by some deployments)
  // EMAIL_HOST: z.string().optional(),
  // EMAIL_PORT: z.coerce.number().int().positive().optional(),
  // EMAIL_USER: z.string().optional(),
  // EMAIL_PASS: z.string().optional(),
  // EMAIL_FROM: z.string().optional(),
  EMAIL_CODE_PEPPER: z.string().min(8).default("change_me_pepper"),
  // --- Google Calendar integration (optional) ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  // Used to encrypt OAuth refresh tokens at rest (set a long random string).
  TOKEN_ENCRYPTION_KEY: z.string().min(16).optional(),
  // --- BigBlueButton (BBB) ---
  BBB_BASE_URL: z.string().min(1).optional(),
  BBB_SHARED_SECRET: z.string().min(1).optional(),
  // Optional: override the base URL that will be stored in `meetingLink`
  // (e.g. https://api.yourdomain.com). If omitted, backend derives it from the request host.
  PUBLIC_BACKEND_URL: z.string().url().optional(),
  // Optional: salt for deriving per-meeting moderator/attendee passwords.
  // If omitted, BBB_SHARED_SECRET is used as the salt.
  MEETING_PASSWORD_SALT: z.string().optional(),
});

export type Env = {
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  EMAIL_HOST?: string;
  EMAIL_PORT?: number;
  EMAIL_USER?: string;
  EMAIL_PASS?: string;
  EMAIL_FROM?: string;
  EMAIL_CODE_PEPPER: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  BBB_BASE_URL?: string;
  BBB_SHARED_SECRET?: string;
  PUBLIC_BACKEND_URL?: string;
  MEETING_PASSWORD_SALT?: string;
};

const raw = RawEnvSchema.parse(process.env);

const mongoUri = raw.MONGO_URI ?? raw.MONGODB_URI;
if (!mongoUri) {
  throw new Error("Missing Mongo connection string. Set MONGO_URI (or MONGODB_URI) in backend/.env");
}

let jwtSecret = (raw.JWT_SECRET ?? "").trim();
if (jwtSecret.length < 16) {
  // Dev fallback so the server can start. Tokens will be invalidated on restart if you change this.
  // eslint-disable-next-line no-console
  console.warn("JWT_SECRET is missing/too short; using a development fallback. Set JWT_SECRET (>= 16 chars) in backend/.env");
  jwtSecret = "dev_jwt_secret_change_me_123456";
}

export const env: Env = {
  PORT: raw.PORT,
  MONGO_URI: mongoUri,
  JWT_SECRET: jwtSecret,
  CORS_ORIGIN: raw.CORS_ORIGIN,
  EMAIL_HOST: raw.EMAIL_HOST ?? raw.EMAIL_HOST,
  EMAIL_PORT: raw.EMAIL_PORT ?? raw.EMAIL_PORT,
  EMAIL_USER: raw.EMAIL_USER ?? raw.EMAIL_USER,
  EMAIL_PASS: raw.EMAIL_PASS ?? raw.EMAIL_PASS,
  EMAIL_FROM: raw.EMAIL_FROM ?? raw.EMAIL_FROM,
  EMAIL_CODE_PEPPER: raw.EMAIL_CODE_PEPPER,
  GOOGLE_CLIENT_ID: raw.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: raw.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: raw.GOOGLE_REDIRECT_URI,
  TOKEN_ENCRYPTION_KEY: raw.TOKEN_ENCRYPTION_KEY,
  BBB_BASE_URL: raw.BBB_BASE_URL,
  BBB_SHARED_SECRET: raw.BBB_SHARED_SECRET,
  PUBLIC_BACKEND_URL: raw.PUBLIC_BACKEND_URL,
  MEETING_PASSWORD_SALT: raw.MEETING_PASSWORD_SALT,
};

