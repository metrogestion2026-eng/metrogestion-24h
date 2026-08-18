import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { getOrCreateDeviceToken } from './device.js';

const deviceToken = getOrCreateDeviceToken();

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'metrogestion.clean.auth.v1'
  },
  global: {
    headers: {
      'x-device-token': deviceToken,
      'x-client-info': 'metrogestion-clean-r1'
    }
  }
});

export { deviceToken };
