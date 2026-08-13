import { hotelV39 } from './hotel-v39-reglas.js';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};

const units=[
  {id:'A',fleet:'R1488',reserve:'R1269',retiredFromActive:true,stopNumber:'2600100',stages:[
    {name:'T realizada',status:'realizada'},
    {name:'ITV pendiente',status:'pendiente'}
  ]},
  {id:'B',fleet:'2709',reserve:'2497',retiredFromActive:false,stopNumber:'2600101',dbState:'en_taller',stages:[
    {name:'Taller',status:'pendiente'}
  ]},
  {id:'C',fleet:'',reserve:'2545',retiredFromActive:false,stopNumber:'2600106',dbState:'en_taller',stages:[
    {name:'MCD reserva',status:'pendiente'}
  ]}
];
const reserves=[{code:'R1269'},{code:'2497'},{code:'2676'},{code:'2545'}];

assert(hotelV39.activeHotelUnits(units).map(x=>x.id).join(',')==='B,C','Un recuperado no puede seguir en Hotel activo');
assert(hotelV39.programmedStages(units).some(x=>x.fleet==='R1488'&&x.stage.name==='ITV pendiente'),'Las T pendientes del recuperado deben seguir en T programadas');
assert(!hotelV39.programmedStages(units).some(x=>x.stage.name==='T realizada'),'Una T realizada no debe seguir programada');
assert(hotelV39.freeReserves(reserves,units).some(x=>x.code==='R1269'),'La reserva del recuperado debe quedar libre');
assert(!hotelV39.freeReserves(reserves,units).some(x=>x.code==='2497'),'La reserva de una sustitución activa debe seguir ocupada');
assert(hotelV39.freeReserves(reserves,units).some(x=>x.code==='2545'),'Una reserva con trabajo propio puede estar libre de sustitución');
assert(!hotelV39.availableReserves(reserves,units).some(x=>x.code==='2545'),'Una reserva con trabajo propio no debe estar disponible para asignar');
assert(hotelV39.stopHeading(units[0])==='PARADA Nº 2600100','El número de parada debe estar disponible para cabecera');
const cleanReserve=hotelV39.freeReserveCard({code:'R1269',plate:'1111AAA',label:'RESERVA'});
assert(cleanReserve.stopNumber===''&&cleanReserve.stages.length===0,'Una reserva libre no debe heredar número de parada ni T antiguas');

const reader={role:'reader',permissions:{hotel:{ver:true,editar:false}}};
const editor={role:'editor',permissions:{hotel:{ver:true,editar:true}}};
const denied={role:'reader',permissions:{hotel:{ver:false,editar:false}}};
const dossierUnit={
  id:'D',fleet:'2660',fleetPlate:'7546MWW',reserve:'2676',reservePlate:'1802NBF',stopNumber:'2600108',stages:[{
    name:'MCD · Mantenimiento',code:'MCD',status:'pendiente',position:1,
    provider:'AUTO DISTRIBUCIÓN',center:'Hospitalet',plannedAt:'2026-08-11T06:00:00Z',
    orderNumber:'2600435',workshopOrderNumber:'OR-7788',kilometers:312450,
    diagnosis:'Revisión general',notes:'Pendiente de recoger',
    works:[{type:'M',description:'Mantenimiento'}],
    documents:[{name:'pedido-2600435.pdf',url:'doc://1'}],
    photos:[{name:'entrada.jpg',url:'img://1'}],
    emails:[{to:'taller@ejemplo.es',sentAt:'2026-08-11T07:00:00Z'}],
    history:[{action:'creada',at:'2026-08-10T10:00:00Z'}]
  }]
};
const readerDossier=hotelV39.stageDossierForReader(dossierUnit,0,reader);
assert(readerDossier.allowed===true,'Un lector autorizado debe poder abrir una T');
assert(readerDossier.dossier.stopNumber==='2600108'&&readerDossier.dossier.documents.length===1&&readerDossier.dossier.photos.length===1,'La vista de lectura debe incluir parada, documentos y fotos');
assert(readerDossier.dossier.works.length===1&&readerDossier.dossier.emails.length===1&&readerDossier.dossier.history.length===1,'La vista de lectura debe incluir trabajos, correos e historial');
assert(hotelV39.stageDossierForReader(dossierUnit,0,editor).allowed===true,'Un editor también debe poder leer toda la T');
assert(hotelV39.stageDossierForReader(dossierUnit,0,denied).allowed===false,'Sin permiso de Hotel no se puede abrir el expediente de la T');

const maintenancePendings=[
  {id:'MCD-2709',code:'MCD',nombre:'MCD · Mantenimiento',fecha:'2026-08-20',observaciones:'Mantenimiento caducado'},
  {id:'ITV-2709',code:'ITV',nombre:'ITV',fecha:'2026-08-25'},
  {id:'RT-2709',code:'RT',nombre:'RT',completed:true}
];
const existingStages=[{name:'ITV',code:'ITV',sourceKey:'ITV-2709',status:'pendiente'}];
const merged=hotelV39.mergeSubstitutionStages(existingStages,maintenancePendings);
assert(merged.some(x=>x.code==='MCD'&&x.autoCreated===true&&x.editable===true),'Al crear sustitución debe crear T de pendientes de MANTENIMENT');
assert(merged.filter(x=>x.code==='ITV').length===1,'No debe duplicar una T ya existente');
assert(!merged.some(x=>x.code==='RT'),'No debe crear T de un pendiente ya realizado');

console.log('Hotel v39 reglas: OK');
