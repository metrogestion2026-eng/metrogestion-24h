import '../../r1-alpha37/src/app.js';

const VERSION='r1.0.0-alpha.38';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');

const FIXED_LOCATIONS={
  abrera:{plus:'GV6V+62 Abrera',coordinates:'41.510562, 1.892562'},
  sansa:{plus:"CRJ3+HG Sant Sadurní d'Anoia",coordinates:'41.431438, 1.803813'},
  disfrimur:{plus:"CRM4+G2 Sant Sadurní d'Anoia",coordinates:'41.433813, 1.805063'}
};

function setInputValue(input,value){
  const next=String(value??'');
  if(input.value===next)return;
  input.value=next;
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

function setFieldPresentation(input,format){
  const label=input.closest('label');
  const title=label?.querySelector('span');
  if(format==='coordinates'){
    if(title&&title.textContent!=='Coordenadas')title.textContent='Coordenadas';
    input.placeholder='Ej. 41.5167, 1.9012';
  }else if(format==='plus'){
    if(title&&title.textContent!=='Plus Code')title.textContent='Plus Code';
    input.placeholder='Ej. GV6V+62 Abrera';
  }else{
    if(title&&title.textContent!=='Ubicación')title.textContent='Ubicación';
    input.placeholder='Introduce la ubicación manualmente';
  }
}

function inferFormat(type,value){
  const fixed=FIXED_LOCATIONS[type];
  const current=String(value||'').trim();
  if(fixed){
    if(current===fixed.coordinates)return 'coordinates';
    if(current===fixed.plus)return 'plus';
    if(current)return 'manual';
    return 'plus';
  }
  return 'manual';
}

function applyLocationFormat(typeSelect,formatSelect,input,{clearManual=false,forceAuto=false}={}){
  const type=typeSelect.value;
  const format=formatSelect.value;
  const fixed=FIXED_LOCATIONS[type];
  setFieldPresentation(input,format);
  if(fixed&&format==='coordinates'){
    if(forceAuto||!input.value.trim()||input.value===fixed.plus)setInputValue(input,fixed.coordinates);
    return;
  }
  if(fixed&&format==='plus'){
    if(forceAuto||!input.value.trim()||input.value===fixed.coordinates)setInputValue(input,fixed.plus);
    return;
  }
  if(format==='manual'){
    if(clearManual)setInputValue(input,'');
    return;
  }
  if(!fixed&&clearManual)setInputValue(input,'');
}

function patchLocationStep(){
  const typeSelect=content?.querySelector('#h24-ltype');
  const input=content?.querySelector('#h24-location');
  if(!typeSelect||!input)return;
  const inputLabel=input.closest('label');
  if(inputLabel&&!inputLabel.classList.contains('h24-wide'))inputLabel.classList.add('h24-wide');
  let formatSelect=content.querySelector('#a38-location-format');
  if(!formatSelect){
    const formatLabel=document.createElement('label');
    const formatTitle=document.createElement('span');
    formatTitle.textContent='Formato de ubicación';
    formatSelect=document.createElement('select');
    formatSelect.id='a38-location-format';
    formatSelect.innerHTML='<option value="coordinates">Coordenadas</option><option value="plus">Plus Code</option><option value="manual">Ubicación</option>';
    formatLabel.append(formatTitle,formatSelect);
    formatSelect.value=inferFormat(typeSelect.value,input.value);
    inputLabel?.before(formatLabel);
    const note=document.createElement('div');
    note.id='a38-location-note';
    note.className='text-small muted h24-wide';
    note.textContent='Abrera, Sansa y Disfrimur: Coordenadas y Plus Code se rellenan automáticamente. Ubicación se introduce manualmente.';
    inputLabel?.after(note);
    formatSelect.addEventListener('change',()=>{
      applyLocationFormat(typeSelect,formatSelect,input,{clearManual:true,forceAuto:true});
    });
    typeSelect.addEventListener('change',()=>{
      if(FIXED_LOCATIONS[typeSelect.value]){
        applyLocationFormat(typeSelect,formatSelect,input,{clearManual:formatSelect.value==='manual',forceAuto:true});
      }else{
        formatSelect.value='manual';
        applyLocationFormat(typeSelect,formatSelect,input,{clearManual:true});
      }
    });
  }
  setFieldPresentation(input,formatSelect.value);
  if(FIXED_LOCATIONS[typeSelect.value]&&!input.value.trim()){
    applyLocationFormat(typeSelect,formatSelect,input,{forceAuto:true});
  }
}

const observer=new MutationObserver(()=>patchLocationStep());
if(content)observer.observe(content,{childList:true,subtree:true});
patchLocationStep();
