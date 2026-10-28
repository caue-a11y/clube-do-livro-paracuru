// Version existence verified at jsDelivr package.json (1.13.15), 2026-10-28.
// /max metadata validates full number patterns, not just plausible lengths.
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.13.15/max';
import schema from './questionario.json' with { type: 'json' };
import { createHandler } from './app.mjs';

Deno.serve(createHandler({
  schema,
  parsePhoneNumber: parsePhoneNumberFromString,
  supabaseURL: Deno.env.get('SUPABASE_URL'),
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}));
