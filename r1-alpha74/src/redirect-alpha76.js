import { supabase } from '../../r1-alpha17/src/supabase.js';

const TARGET = new URL('../r1-alpha76/', window.location.href);
let redirecting = false;

async function redirectStandardUser() {
  if (redirecting || window.location.pathname.includes('/r1-alpha76/')) return;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (authError || !userId) return;

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('tipo_usuario,activo')
    .eq('id', userId)
    .single();

  if (profileError || !profile?.activo || profile.tipo_usuario === 'administrador_principal') return;

  redirecting = true;
  sessionStorage.setItem('metrogestionRedirectedFrom', 'alpha74');
  window.location.replace(TARGET.href);
}

supabase.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
    window.setTimeout(() => void redirectStandardUser(), 0);
  }
});

void redirectStandardUser();
