import { z } from "zod";

// Next.js inlines NEXT_PUBLIC_* values only when they are written out literally.
export const env = z
  .object({
    supabaseUrl: z.string().url(),
    supabasePublishableKey: z.string().min(1),
  })
  .parse({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
