import { clear, detail, element, notice } from '../../../r1-alpha8/src/dom.js';
import { supabase } from '../../../r1-alpha8/src/supabase.js';

const COLOR_LABELS = Object.freeze({
  blanco:'Blanco', verde:'Verde', calabaza:'Calabaza', azul:'Azul', marron:'Marrón', lila:'Lila', trazo_marron:'Trazo marrón'
});

function metric(label,value){ return element('div',{className:'metric'},[element('strong',{text:value}),element('span',{className:'muted',text:label})]); }
function title(row){
  if(row.flota) return `${String(row.flota).startsWith('R')?'Semirremolque':'DFM'} ${row.flota}${row.matricula_flota?` · ${row.matricula_flota}`:''}`;
  return `Reserva ${row.reserva || '—'}${row.matricula_reserva?` · ${row.matricula_reserva}`:''}`;
}
function swatch(code){ return element('span',{className:`hotel-color-swatch color-${code || 'none'}`,text:COLOR_LABELS[code] || 'Sin definir'}); }
function renderCard(row){
  const finalColor=row.color_final;
  const card=element('article',{className:`card color-review-card color-card-${finalColor || 'none'}`},[
    element('div',{className:'hotel-card-head'},[
      element('div',{},[
        element('h3',{text:title(row)}),
        element('div',{className:'muted',text:row.numero_parada?`Parada ${row.numero_parada}`:'Reserva libre · sin parada'})
      ]),
      element('div',{className:'color-badges'},[
        swatch(finalColor),
        element('span',{className:`badge ${row.color_resuelto?'color-ok':'color-pending'}`,text:row.color_resuelto?'Color resuelto':'Revisar color'})
      ])
    ]),
    element('div',{className:'detail-grid color-detail-grid'},[
      detail('Estado actual',row.etiqueta_destino || row.estado_destino),
      detail('Color propuesto',COLOR_LABELS[row.color_propuesto] || 'Sin propuesta'),
      detail('Motivo de la propuesta',row.motivo_color_propuesto),
      detail('Prioridad',row.prioridad_final ?? '—'),
      detail('INC',row.incidencia_final || '—'),
      detail('Lugar',row.lugar || '—')
    ])
  ]);
  if(row.observaciones_revision){
    card.append(element('div',{className:'color-annotation'},[
      element('strong',{text:'Anotación validada'}),
      element('p',{text:row.observaciones_revision})
    ]));
  }
  const pending=Array.isArray(row.color_pendientes)?row.color_pendientes.filter(Boolean):[];
  if(pending.length){
    const ul=element('ul',{className:'color-pending-list'}); pending.forEach(x=>ul.append(element('li',{text:x})));
    card.append(element('div',{className:'notice warning'},[element('strong',{text:'Revisión necesaria:'}),ul]));
  }
  if(row.clasificacion!=='reserva_libre'){
    const controls=element('div',{className:'color-controls'});
    const select=element('select',{className:'color-select'});
    ['blanco','verde','calabaza','azul','marron','lila','trazo_marron'].forEach(code=>{
      const opt=element('option',{value:code,text:COLOR_LABELS[code]}); if(code===finalColor) opt.selected=true; select.append(opt);
    });
    const note=element('textarea',{placeholder:'Explicación obligatoria para marrón o trazo marrón.'}); note.value=row.color_observaciones || '';
    const validate=element('label',{className:'color-check'},[
      element('input',{type:'checkbox'}),
      element('span',{text:'Validar color'})
    ]);
    validate.querySelector('input').checked=Boolean(row.color_validada);
    const save=element('button',{className:'button primary',type:'button',text:'Guardar color'});
    const status=element('span',{className:'status-message'});
    save.addEventListener('click',async()=>{
      save.disabled=true; status.textContent='Guardando…';
      const requestId=`color_${crypto.randomUUID().replaceAll('-','')}`;
      const {data,error}=await supabase.rpc('guardar_revision_color_hotel',{
        p_importacion_id:row.importacion_id,
        p_revisiones:[{fila_id:row.fila_id,version:row.color_revision_version || 0,color:select.value,observaciones:note.value,validada:validate.querySelector('input').checked}],
        p_request_id:requestId
      });
      if(error){ status.textContent=error.message; save.disabled=false; return; }
      status.textContent=`Guardado · auditoría ${data?.eventos_auditoria ?? '—'}`;
      setTimeout(()=>renderHotelColorPreview(document.querySelector('#module-content')),450);
    });
    controls.append(select,note,validate,save,status); card.append(controls);
  }
  return card;
}

export async function renderHotelColorPreview(container){
  clear(container);
  container.append(element('div',{className:'module-heading'},[
    element('div',{},[
      element('h2',{text:'Hotel real · Colores operativos'}),
      element('p',{className:'muted',text:'Color + estado + anotación. Todavía no aplica nada al Hotel activo.'})
    ]),
    element('span',{className:'badge',text:'Administrador principal'})
  ]));
  const loading=notice('Calculando colores desde las fichas validadas…','warning'); container.append(loading);
  const {data,error}=await supabase.from('hotel_importacion_color_previa').select('*').order('source_row',{ascending:true});
  loading.remove();
  if(error){ container.append(notice(`No se pudo cargar la previa de colores: ${error.message}`,'danger')); return; }
  const rows=data||[];
  const counts={}; rows.forEach(r=>counts[r.color_final]=(counts[r.color_final]||0)+1);
  container.append(
    notice('Las propuestas automáticas solo usan casos inequívocos. Marrón y trazo marrón deben validarse manualmente cuando dependan de una sustitución temporal entre vehículos de flota.','success'),
    element('div',{className:'color-legend'},[
      ['blanco','Pendiente taller'],['verde','Reserva libre'],['calabaza','Pendiente recuperar'],['azul','Pendiente recoger'],['marron','Flota sustituta temporal'],['lila','En taller'],['trazo_marron','Reparación sin sustitución']
    ].map(([code,text])=>element('div',{className:'color-legend-item'},[swatch(code),element('span',{text})]))),
    element('div',{className:'summary-grid'},[
      metric('Blanco',counts.blanco||0),metric('Verde',counts.verde||0),metric('Calabaza',counts.calabaza||0),metric('Azul',counts.azul||0),
      metric('Lila',counts.lila||0),metric('Marrón',counts.marron||0),metric('Trazo marrón',counts.trazo_marron||0),metric('Sin definir',counts[null]||0)
    ])
  );
  const host=element('div',{className:'grid color-review-list'}); rows.forEach(r=>host.append(renderCard(r))); container.append(host);
  container.append(notice('Esta fase solo formaliza la representación visual. No existe acción para importar o aplicar al Hotel activo.','warning'));
}
