const status = document.querySelector('#status');

function setStatus(message) {
  if (status) status.textContent = message;
}

async function forceUpdate() {
  setStatus('Retirando componentes antiguos…');

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    } catch {}
  }

  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => key.startsWith('gestion-24h-') || key.startsWith('gestion-metrogestion-'))
          .map(key => caches.delete(key))
      );
    } catch {}
  }

  setStatus('Abriendo la versión actual…');
  const target = new URL('./', window.location.href);
  target.searchParams.set('v', '75.24');
  target.searchParams.set('_reset', String(Date.now()));
  window.location.replace(target.toString());
}

void forceUpdate();
