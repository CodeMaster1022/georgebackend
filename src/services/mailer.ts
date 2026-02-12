import nodemailer from "nodemailer";

const isConnectionError = (error: any) => {
  const code = String(error?.code ?? "");
  return (
    [
      "ECONNECTION",
      "ESOCKET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
    ].includes(code) || String(error?.command ?? "") === "CONN"
  );
};

const logDevOtp = (email: string, otp: string) => {
  // eslint-disable-next-line no-console
  console.log(`[email][dev] OTP for ${email}: ${otp}`);
};

function createTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS environment variables are required');
  }

  const host = process.env.EMAIL_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.EMAIL_PORT || "587");

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    // Fail faster on unreachable SMTP hosts
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: {
      rejectUnauthorized: false
    }
  });
};

export async function sendVerificationCodeEmail(to: string, code: string) {
  // Reuse the OTP style/template for email verification codes.
  return sendOTPEmail(to, code);
}


const sendOTPEmail = async (email: string, otp: string, firstName = '') => {
  try {
    // Validate email configuration before creating transporter
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('Email configuration missing: EMAIL_USER or EMAIL_PASS not set');
      throw new Error('Email service is not configured. Please contact support.');
    }

    const transporter = createTransporter();
    
    // Verify connection
    await transporter.verify();
    console.log('Email server connection verified');
    
    const emailFrom = process.env.EMAIL_FROM || 'Aesthetics HQ';
    const fromAddress = process.env.EMAIL_USER;
    const greeting = firstName ? `Hello ${firstName},` : 'Hello,';

    const mailOptions = {
      from: `"${emailFrom}" <${fromAddress}>`,
      to: email,
      subject: 'Verify Your Email Address',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Email Verification</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #59248F 0%, #7638ec 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0;">Email Verification</h1>
          </div>
          <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0;">
            <p style="font-size: 16px; margin-bottom: 20px;">${greeting}</p>
            <p style="font-size: 16px; margin-bottom: 20px;">
              Thank you for registering! Please verify your email address by entering the verification code below:
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <div style="display: inline-block; background: #59248F; color: white; padding: 20px 40px; border-radius: 10px; font-weight: bold; font-size: 32px; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
            </div>
            <p style="font-size: 14px; color: #666; margin-top: 30px;">
              This verification code will expire in 10 minutes. If you didn't create an account, please ignore this email.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
            <p style="font-size: 12px; color: #999; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Aesthetics HQ. All rights reserved.
            </p>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('OTP email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    // Dev fallback so you can still verify while SMTP is unreachable.
    if (isConnectionError(error) && process.env.NODE_ENV !== "production") {
      const host = process.env.EMAIL_HOST || "smtp.gmail.com";
      const port = parseInt(process.env.EMAIL_PORT || "587");
      // eslint-disable-next-line no-console
      console.warn(`[email][dev] SMTP unreachable (${host}:${port}). Logging OTP instead.`);
      logDevOtp(email, otp);
      return { success: false, devFallback: true };
    }

    console.error('Error sending OTP email:', error);

    // Provide more specific error messages
    if (error.code === 'EAUTH') {
      throw new Error('Email authentication failed. Please check EMAIL_USER and EMAIL_PASS.');
    } else if (isConnectionError(error)) {
      const host = process.env.EMAIL_HOST || "smtp.gmail.com";
      const port = parseInt(process.env.EMAIL_PORT || "587");
      throw new Error(`Failed to connect to email server (${host}:${port}). Please check EMAIL_HOST and EMAIL_PORT.`);
    } else if (error.message && error.message.includes('EMAIL_USER')) {
      throw error; // Re-throw configuration errors
    } else {
      throw new Error(`Failed to send OTP email: ${error.message || 'Unknown error'}`);
    }
  }
};

