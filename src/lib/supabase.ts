import { createClient } from '@supabase/supabase-js';

// Vite requires 'import.meta.env' to access environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Safety check for local development
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "CRITICAL: Supabase keys are missing! \\n" +
    "1. Ensure .env.local exists in the project root. \\n" +
    "2. Ensure variables start with VITE_ (e.g., VITE_SUPABASE_URL). \\n" +
    "3. Restart your dev server (Ctrl+C then npm run dev)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);