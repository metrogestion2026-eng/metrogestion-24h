const content = document.querySelector('#module-content');

// Fuente operativa: Manual_24H_DFM_v2_1.pdf, sección "Activación por marca".
const PROTOCOLS = {
  IVECO: {
    service: 'IVECO Assistance Non Stop (ANS)',
    method: 'Llamada directa a asistencia',
    phone: '+800 8274 7368',
    tel: '+80082747368',
    callLabel: 'Llamar a IVECO Assistance Non Stop',
    notes: [
      'Según contrato de la empresa.',
      'Taller de referencia: Gines Huertas · Molina de Segura, Murcia.',
    ],
  },
  MERCEDES: {
    service: 'Mercedes-Benz Trucks Service24h',
    method: 'My TruckPoint como canal principal',
    phone: '00 800 57 777 777',
    tel: '0080057777777',
    callLabel: 'Llamar al Service24h',
    portal: 'https://mytruckpoint.mercedes-benz-trucks.com/landing',
    portalLabel: 'Abrir Mercedes / My TruckPoint',
    notes: ['La llamada es el canal alternativo si My TruckPoint no está disponible.'],
  },
  MAN: {
    service: 'MAN Mobile24',
    method: 'Llamada directa a asistencia',
    phone: '00800 66 24 53 24',
    tel: '0080066245324',
    callLabel: 'Llamar a MAN Mobile24',
    key: '20244',
    notes: ['Facilita la clave de asistencia cuando el operador la solicite.'],
  },
  VOLVO: {
    service: 'Volvo Action Service (VAS)',
    method: 'Llamada directa a asistencia',
    phone: '900 99 32 47',
    tel: '900993247',
    callLabel: 'Llamar a Volvo Action Service',
    notes: ['Solicita la apertura de asistencia y anota el número de incidencia.'],
  },
};

function ensureStyle() {
  if (document.querySelector('#alpha70-assistance-style')) return;
  const style = document.createElement('style');
  style.id = 'alpha70-assistance-style';
  style.textContent = `
    .a70-protocol{display:grid;gap:10px;padding:14px;border:2px solid #075985;border-radius:14px;background:#f0f9ff}
    .a70-protocol-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
    .a70-method{padding:4px 9px;border-radius:999px;background:#075985;color:#fff;font-size:.82rem;font-weight:800}
    .a70-phone{font-size:1.25rem;font-weight:900;color:#075985;letter-spacing:.02em}
    .a70-notes{display:grid;gap:5px;margin:0;padding-left:20px}
    .a70-actions{display:flex;gap:8px;flex-wrap:wrap}
    .a70-actions .button{flex:1 1 230px;box-sizing:border-box}
    .a70-key{padding:10px 12px;border:1px solid #f59e0b;border-radius:10px;background:#fffbeb;color:#92400e}
    .a70-missing{display:grid;gap:8px;padding:14px;border:1px solid #f59e0b;border-radius:12px;background:#fffbeb;color:#78350f}
    .a70-readonly{background:#f1f5f9!important;font-weight:800}
  `;
  document.head.append(style);
}

function summaryValue(label) {
  const rows = [...(content?.querySelectorAll('.h24-summary-row') || [])];
  const row = rows.find((item) => item.firstElementChild?.textContent?.trim().toLowerCase() === label.toLowerCase());
  return row?.lastElementChild?.textContent?.trim() || '';
}

function vehicleBrand() {
  const value = summaryValue('Marca / modelo').toUpperCase();
  return Object.keys(PROTOCOLS).find((brand) => value.startsWith(brand)) || value.split(/\s+/)[0] || '';
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function patchAssistanceStep() {
  const mode = content?.querySelector('#a40-call-mode');
  const card = mode?.closest('.h24-card');
  const title = card?.querySelector('h3');
  if (!mode || title?.textContent?.trim() !== 'Contrato y llamada' || mode.dataset.alpha70Patched === '1') return;

  const brand = vehicleBrand();
  const protocol = PROTOCOLS[brand];
  const phone = mode.querySelector('#a40-assistance-phone');
  const call = mode.querySelector('#a40-call-button');
  const phoneWrap = phone?.closest('label');
  const serviceBox = mode.querySelector('.a40-call-head .h24-status');
  if (!phone || !call || !phoneWrap || !serviceBox) return;

  mode.dataset.alpha70Patched = '1';
  mode.querySelector('#a41-mercedes-first')?.remove();
  [...mode.querySelectorAll('.a41-mercedes-second')].forEach((node) => node.remove());

  if (!protocol) {
    serviceBox.textContent = brand ? `Asistencia ${brand}` : 'Asistencia según fabricante';
    const missing = element('div', null, 'a70-missing');
    missing.append(
      element('strong', 'Teléfono no definido en el Manual 24H v2.1'),
      element('span', 'No se permite abrir una llamada con un número supuesto. Consulta el manual o contacta con TM Delegación Barcelona.'),
    );
    phone.value = '';
    phone.readOnly = true;
    phone.classList.add('a70-readonly');
    call.disabled = true;
    phoneWrap.before(missing);
    const note = phoneWrap.querySelector('.a40-note');
    if (note) note.textContent = 'Falta incorporar este fabricante al manual operativo.';
    return;
  }

  serviceBox.textContent = protocol.service;
  const details = element('section', null, 'a70-protocol');
  const head = element('div', null, 'a70-protocol-head');
  const headCopy = element('div');
  headCopy.append(element('strong', protocol.service), element('div', protocol.method, 'muted'));
  head.append(headCopy, element('span', `Método · ${protocol.method}`, 'a70-method'));
  details.append(head, element('div', `📞 ${protocol.phone}`, 'a70-phone'));

  if (protocol.key) details.append(element('div', `Clave de asistencia MAN: ${protocol.key}`, 'a70-key'));
  const notes = element('ul', null, 'a70-notes');
  protocol.notes.forEach((note) => notes.append(element('li', note)));
  details.append(notes);

  if (protocol.portal) {
    const actions = element('div', null, 'a70-actions');
    const portal = element('a', protocol.portalLabel, 'button primary');
    portal.href = protocol.portal;
    portal.target = '_blank';
    portal.rel = 'noopener';
    actions.append(portal);
    details.append(actions);
  }

  phoneWrap.before(details);
  const label = phoneWrap.querySelector('span:not(.a40-note)');
  if (label) label.textContent = protocol.service;
  phone.value = protocol.phone;
  phone.readOnly = true;
  phone.classList.add('a70-readonly');
  phone.dispatchEvent(new Event('input', { bubbles: true }));
  const note = phoneWrap.querySelector('.a40-note');
  if (note) note.textContent = `Número cargado automáticamente desde el Manual 24H v2.1 · ${protocol.phone}.`;
  call.textContent = `📞 ${protocol.callLabel} · ${protocol.phone}`;
  call.disabled = false;
  call.onclick = () => {
    window.location.href = `tel:${protocol.tel}`;
  };
}

ensureStyle();
const observer = new MutationObserver(() => patchAssistanceStep());
if (content) observer.observe(content, { childList: true, subtree: true });
patchAssistanceStep();
