import { hotelV39 } from './hotel-v39-reglas.js';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};

const units=[
  {id:'A',fleet:'R1488',reserve:'R1269',retiredFromActive:true,stopNumber:'2600100',stages:[
    {name:'T realizada',status:'realizada'},
    {name:'ITV pendiente',status:'pendiente'}
  ]},
  {id:'B',fleet:'2709',reserve:'2497',retiredFromActive:false,stopNumber:'2600101',stages:[
    {name:'Taller',status:'pendiente'}
  ]}
];
const reserves=[{code:'R1269'},{code:'2497'},{code:'2676'}];

assert(hotelV39.activeHotelUnits(units).map(x=>x.id).join(',')==='B','Un recuperado no puede seguir en Hotel activo');
assert(hotelV39.programmedStages(units).some(x=>x.fleet==='R1488'&&x.stage.name==='ITV pendiente'),'Las T pendientes del recuperado deben seguir en T programadas');
assert(!hotelV39.programmedStages(units).some(x=>x.stage.name==='T realizada'),'Una T realizada no debe seguir programada');
assert(hotelV39.freeReserves(reserves,units).some(x=>x.code==='R1269'),'La reserva del recuperado debe quedar libre');
assert(!hotelV39.freeReserves(reserves,units).some(x=>x.code==='2497'),'La reserva de una sustitución activa debe seguir ocupada');
assert(hotelV39.stopHeading(units[0])==='PARADA Nº 2600100','El número de parada debe estar disponible para cabecera');

console.log('Hotel v39 reglas: OK');
