import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Gmail SMTP transport factory. Uses the sender's own Gmail address plus a
 * Google "App Password" (requires 2-Step Verification on the account).
 */

export interface GmailCredentials {
  gmailAddress: string;
  appPassword: string;
}

export function createGmailTransport(
  creds: GmailCredentials,
): Transporter {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: creds.gmailAddress,
      pass: creds.appPassword,
    },
  });
}

/** Verify credentials against Gmail. Throws if the login/connection fails. */
export async function verifyGmailTransport(
  creds: GmailCredentials,
): Promise<void> {
  const transport = createGmailTransport(creds);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

