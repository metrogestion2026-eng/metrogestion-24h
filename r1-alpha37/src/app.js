import '../../r1-alpha36/src/app.js';

const VERSION='r1.0.0-alpha.37';
const versionNode=document.querySelector('#app-version');
if(versionNode)versionNode.textContent=VERSION;

const content=document.querySelector('#module-content');
let lastPhoneInput=null;

function syncAutomaticPhone(){
  const phone=content?.querySelector('#h24-phone');
  if(!phone||!phone.value.trim()||phone===lastPhoneInput)return;
  lastPhoneInput=phone;
  phone.dispatchEvent(new Event('input',{bubbles:true}));
}

const observer=new MutationObserver(()=>syncAutomaticPhone());
if(content)observer.observe(content,{childList:true,subtree:true});

content?.addEventListener('change',event=>{
  if(event.target?.id==='h24-dfm')setTimeout(()=>{lastPhoneInput=null;syncAutomaticPhone();},0);
});

requestAnimationFrame(()=>setTimeout(syncAutomaticPhone,100));
