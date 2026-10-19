import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export type ProfileRole = "rancangan" | "juri" | "super_user" | "developer";

export function normalizeProfileRole(role: string | null | undefined): ProfileRole | null {
  switch (role) {
    case "awam":
    case "rancangan":
      return "rancangan";
    case "juri":
      return "juri";
    case "super_user":
      return "super_user";
    case "admin":
    case "developer":
      return "developer";
    default:
      return null;
  }
}