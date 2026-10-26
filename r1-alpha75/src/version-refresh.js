const CURRENT_VERSION = 'r1.0.0-alpha.75.23-hf31';

async function refreshIfOutdated() {
  try {
    const versionUrl = new URL('./app.js', import.meta.url);
    versionUrl.searchParams.set('_', String(Date.now()));
    const response = await fetch(versionUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return;

    const source = await response.text();
    const publishedVersion = source.match(/const VERSION = ['\"]([^'\"]+)['\"]/i)?.[1] || '';
    if (!publishedVersion || publishedVersion === CURRENT_VERSION) return;

    const target = new URL(window.location.href);
    const alreadyTargeting = target.searchParams.get('v') === publishedVersion;
    const retryKey = `metrogestion-version-refresh:${publishedVersion}`;

    if (alreadyTargeting && sessionStorage.getItem(retryKey) === '1') return;
    if (alreadyTargeting) sessionStorage.setItem(retryKey, '1');

    target.searchParams.set('v', publishedVersion);
    target.searchParams.set('_refresh', String(Date.now()));
    window.location.replace(target.toString());
  } catch {
    // Un fallo de red no debe impedir el acceso a la versión ya cargada.
  }
}

void refreshIfOutdated();
