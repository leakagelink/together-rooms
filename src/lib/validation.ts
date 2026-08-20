import { z } from "zod";

export const emailSchema = z.string().trim().min(3).max(254).email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Password is too long.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, "3-24 characters: lowercase letters, numbers or underscore.");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2, "Enter a display name.").max(60),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  });

export const profileSchema = z.object({
  username: usernameSchema.optional().or(z.literal("")),
  display_name: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(300).optional().or(z.literal("")),
});

export const roomTypes = [
  "couple",
  "friends",
  "family",
  "study",
  "research",
  "music",
  "watch",
  "game",
  "private",
] as const;

export const createRoomSchema = z.object({
  name: z.string().trim().min(1, "Give the room a name.").max(80),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  type: z.enum(roomTypes),
  max_members: z.coerce.number().int().min(2).max(50),
  invite_only: z.boolean(),
  is_ephemeral: z.boolean(),
});

export const joinRoomSchema = z.object({
  join_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, "Join codes are 6-12 letters and numbers."),
});

export const reportSchema = z.object({
  category: z.string().min(2, "Choose a reason.").max(60),
  details: z.string().trim().max(2000).optional().or(z.literal("")),
});
