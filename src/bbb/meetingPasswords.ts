import { hmacSha256Base64Url } from "../utils/crypto";

export function deriveMeetingPasswords(opts: {
  meetingId: string;
  salt: string;
}): { moderatorPW: string; attendeePW: string } {
  const { meetingId, salt } = opts;

  // BBB passwords are simple strings; keep them URL-safe and reasonably short.
  const mod = hmacSha256Base64Url(salt, `moderator:${meetingId}`).slice(0, 20);
  const att = hmacSha256Base64Url(salt, `attendee:${meetingId}`).slice(0, 20);

  return {
    moderatorPW: `m_${mod}`,
    attendeePW: `a_${att}`
  };
}

