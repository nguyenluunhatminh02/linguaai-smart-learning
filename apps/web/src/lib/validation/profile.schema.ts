import { z } from "zod";

const VALID_LANGUAGES = [
  "vietnamese",
  "english",
  "japanese",
  "korean",
  "chinese",
  "french",
  "spanish",
] as const;

export const profileSchema = z.object({
  displayName: z
    .string()
    .min(1, "Display name is required")
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must not exceed 50 characters")
    .regex(
      /^[a-zA-Z\s'-]+$/,
      "Display name can only contain letters, spaces, hyphens, and apostrophes",
    ),
  nativeLanguage: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.enum(VALID_LANGUAGES).optional(),
  ),
  targetLanguage: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.enum(VALID_LANGUAGES).optional(),
  ),
});

export type ProfileFormData = z.infer<typeof profileSchema>;
