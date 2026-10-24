// Expo inlines EXPO_PUBLIC_* values only when they are written out literally. Both are public by
// design: access is enforced by row-level security, never by hiding these.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see apps/mobile/.env.example).",
  );
}

export const env = { supabaseUrl, supabasePublishableKey };
