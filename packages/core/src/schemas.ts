import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const smtpConfigSchema = z.object({
  gmailAddress: z.string().email(),
  appPassword: z
    // Google app passwords are 16 chars, often shown as "xxxx xxxx xxxx xxxx"
    .string()
    .min(1, 'App password is required')
    .transform((s) => s.replace(/\s+/g, '')),
  fromName: z.string().max(120).optional(),
});

export const campaignInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  subject: z.string().max(500).default(''),
  // Generous for an email, but bounded - the body is stored per campaign and
  // merged per recipient.
  bodyTemplate: z.string().max(100_000, 'Message body is too long').default(''),
});

export const recipientSchema = z.object({
  email: z.string().email(),
  variables: z.record(z.string(), z.unknown()).default({}),
});

export const recipientsPayloadSchema = z.object({
  recipients: z.array(recipientSchema).max(5000),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type SmtpConfigInput = z.infer<typeof smtpConfigSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type RecipientInput = z.infer<typeof recipientSchema>;
