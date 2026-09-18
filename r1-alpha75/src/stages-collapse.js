import { element } from '../../r1-alpha17/src/dom.js';

let sequence = 0;

// El mismo control sirve para lectura, histórico y edición, sin depender del rol.
export function createStagesToggle(content, count) {
  if (!document.querySelector('#stages-collapse-style')) {
    document.head.append(element('style', {
      id: 'stages-collapse-style',
      text: '.stages-collapsible[hidden]{display:none!important}.a75-card-stages-toggle{flex-shrink:0;white-space:nowrap}.editor-stages-section>.editor-section-heading{flex-wrap:wrap}'
    }));
  }
  content.id ||= `ficha-stages-${++sequence}`;
  content.classList.add('stages-collapsible');
  const button = element('button', {
    className: 'button secondary compact a75-card-stages-toggle',
    type: 'button',
    'aria-controls': content.id
  });
  const refresh = () => {
    button.textContent = content.hidden ? `Desplegar T (${count()})` : 'Ocultar T';
    button.setAttribute('aria-expanded', String(!content.hidden));
  };
  const setExpanded = expanded => {
    content.hidden = !expanded;
    refresh();
  };
  button.addEventListener('click', () => setExpanded(content.hidden));
  content.addEventListener('reveal-stages', () => setExpanded(true));
  content.addEventListener('invalid', () => setExpanded(true), true);
  setExpanded(false);
  return { button, setExpanded, refresh };
}

export function revealStagesFor(field) {
  field?.closest('.stages-collapsible')?.dispatchEvent(new Event('reveal-stages'));
}
