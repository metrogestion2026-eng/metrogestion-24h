import '../../r1-alpha41/src/app.js';

const VERSION='r1.0.0-alpha.42';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');
let assistanceNumber='';

function setValueAndNotify(input,value){
  const next=String(value??'');
  if(input.value===next)return;
  input.value=next;
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

function syncCaseNumber(){
  const callInput=content?.querySelector('#a40-case-number');
  const registerInput=content?.querySelector('#h24-case');

  if(callInput){
    const current=callInput.value.trim();
    if(!assistanceNumber&&current)assistanceNumber=current;
    if(assistanceNumber&&callInput.value!==assistanceNumber)callInput.value=assistanceNumber;
  }

  if(registerInput){
    const current=registerInput.value.trim();
    if(!assistanceNumber&&current)assistanceNumber=current;
    if(assistanceNumber)setValueAndNotify(registerInput,assistanceNumber);

    const label=registerInput.closest('label');
    const title=label?.querySelector('span');
    if(title&&title.textContent!=='Número de asistencia / caso · recogido en Paso 5'){
      title.textContent='Número de asistencia / caso · recogido en Paso 5';
    }
  }
}

content?.addEventListener('input',event=>{
  if(event.target?.id==='a40-case-number'){
    assistanceNumber=event.target.value.trim();
    const registerInput=content.querySelector('#h24-case');
    if(registerInput)setValueAndNotify(registerInput,assistanceNumber);
  }
  if(event.target?.id==='h24-case'){
    assistanceNumber=event.target.value.trim();
    const callInput=content.querySelector('#a40-case-number');
    if(callInput&&callInput.value!==assistanceNumber)callInput.value=assistanceNumber;
  }
});

content?.addEventListener('change',event=>{
  if(event.target?.id==='a40-case-number'||event.target?.id==='h24-case'){
    assistanceNumber=event.target.value.trim();
    syncCaseNumber();
  }
});

const observer=new MutationObserver(()=>syncCaseNumber());
if(content)observer.observe(content,{childList:true,subtree:true});
syncCaseNumber();
