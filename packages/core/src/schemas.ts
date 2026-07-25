import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
  bodyTemplate: z.string().default(''),
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
export type SmtpConfigInput = z.infer<typeof smtpConfigSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type RecipientInput = z.infer<typeof recipientSchema>;
