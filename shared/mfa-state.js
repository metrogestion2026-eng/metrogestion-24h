// The database independently enforces the same requirement for enrolled users.
export async function secondFactorState(mfa) {
  const { data: factors, error: factorError } = await mfa.listFactors();
  if (factorError || !Array.isArray(factors?.all)) throw new Error('No se pudo comprobar el segundo factor.');
  const { data: level, error: levelError } = await mfa.getAuthenticatorAssuranceLevel();
  if (levelError || !['aal1', 'aal2'].includes(level?.currentLevel)) throw new Error('No se pudo comprobar la sesión segura.');
  const verified = factors.all.filter(factor => factor.status === 'verified');
  return {
    verified,
    totp: verified.filter(factor => factor.factor_type === 'totp'),
    required: verified.length > 0 && level.currentLevel !== 'aal2',
  };
}

export async function verifySecondFactor(mfa, factorId, code) {
  if (!factorId || !/^\d{6}$/.test(code)) throw new Error('Introduce los seis dígitos de tu aplicación de autenticación.');
  const { error } = await mfa.challengeAndVerify({ factorId, code });
  if (error) throw new Error('El código no es válido o ha caducado. Prueba con el siguiente.');
  const { data, error: levelError } = await mfa.getAuthenticatorAssuranceLevel();
  if (levelError || data?.currentLevel !== 'aal2') throw new Error('No se pudo confirmar el segundo factor.');
}
