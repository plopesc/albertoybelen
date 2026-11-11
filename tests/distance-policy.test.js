import test from 'node:test';
import assert from 'node:assert/strict';
import { startInstant, eligibleMeters, createDistanceState, applyParticipantSync as apply, publicProgress as view } from '../policy/distance-policy.js';
import { reference, activity as a, sync } from './fixtures/distance-policy.js';
const connected = () => ['slot-a','slot-b'].reduce((s, participantId) => apply(s, { participantId, status:'connected', generation:0, scopes:['activity:read_all'] }), createDistanceState(reference));
test('medianoche inclusiva Madrid en CET/CEST, independiente de TZ del proceso', () => {
 for (const [date, expected] of [['2026-11-01','2026-10-31T23:00:00Z'],['2026-07-01','2026-06-30T22:00:00Z'],['2026-03-29','2026-03-28T23:00:00Z'],['2026-10-25','2026-10-24T22:00:00Z'],['2026-11-28','2026-11-27T23:00:00Z']]) assert.equal(new Date(startInstant(date)).toISOString(),expected.replace('Z','.000Z'));
 assert.equal(startInstant('2026-11-01','UTC'), Date.parse('2026-11-01T00:00:00Z'));
 assert.equal(eligibleMeters(a('x',1000,{start_date:'2026-10-31T22:59:59Z',elapsed_time:7200}),reference),0);
 assert.equal(eligibleMeters(a('x',1000,{start_date:'2026-10-31T23:00:00Z'}),reference),1000);
 assert.equal(eligibleMeters(a('x',1000,{start_date:'2026-10-31T23:00:01Z'}),reference),1000);
});
test('deportes exactos, manuales y permiso privado por cuenta', () => {
 for(const sport_type of ['Run','Walk','Hike']) assert.equal(eligibleMeters(a('x',12,{sport_type}),reference),12);
 for(const sport_type of ['Ride','VirtualRun','VirtualRide','TrailRun','run','RunExtra','']) assert.equal(eligibleMeters(a('x',12,{sport_type,type:'Run'}),reference),0);
 assert.equal(eligibleMeters(a('x',12,{sport_type:undefined,type:'Walk'}),reference),12);
 assert.equal(eligibleMeters(a('x',12,{manual:true}),reference),0);
 assert.equal(eligibleMeters(a('x',12,{private:true}),reference),0);
 assert.equal(eligibleMeters(a('x',12,{private:true}),reference,['activity:read_all']),12);
 assert.throws(()=>eligibleMeters(a('x',NaN),reference));
 assert.throws(()=>eligibleMeters(a('x',10,{start_date:'2026-11-01T10:00:00'}),reference));
 assert.throws(()=>startInstant('2026-02-30'));
});
test('dos slots, IDs coincidentes, decimales, importaciones, edición y borrado idempotentes', () => {
 let s=apply(connected(),sync('slot-a',[a('same',1234.5),a('same',1500.25)]));
 s=apply(s,sync('slot-b',[a('same',2500.75)])); assert.equal(view(s).distanceKm,4.001);
 const event=sync('slot-a',[a('same',1000.25)]); s=apply(s,event); assert.deepEqual(apply(s,event),s);
 assert.equal(view(s).distanceKm,3.501);
 s=apply(s,sync('slot-a',[{id:'same',deleted:true}],{complete:false})); assert.equal(view(s).distanceKm,2.50075);
 assert.equal(view(apply(s,sync('slot-b',[]))).distanceKm,0);
});
test('conexión parcial y fallo temporal pueden coexistir, snapshot fallido no aplica cambios', () => {
 let s=apply(createDistanceState(reference),{participantId:'slot-a',generation:0,status:'connected',scopes:['activity:read_all']});
 s=apply(s,sync('slot-a',[a('x',10000)]));
 s=apply(s,{participantId:'slot-a',generation:0,status:'error',httpStatus:429});
 assert.equal(view(s).distanceKm,10); assert.equal(view(s).partial,true); assert.equal(view(s).stale,true);
 assert.throws(()=>apply(s,sync('slot-a',[a('x',5000),a('broken',-1)])));
 assert.equal(view(s).distanceKm,10);
 s=apply(s,sync('slot-a',[a('x',8000)])); assert.equal(view(s).stale,false);
});
test('backfill posterior del segundo slot y repetición no duplican', () => {
 let s=apply(createDistanceState(reference),{participantId:'slot-a',generation:0,status:'connected',scopes:['activity:read_all']});
 s=apply(s,sync('slot-a',[a('x',10000)]));
 s=apply(s,{participantId:'slot-b',generation:0,status:'connected',scopes:['activity:read_all']});
 const event=sync('slot-b',[a('x',5000),a('old',9000,{start_date:'2026-10-01T00:00:00Z'})]);
 s=apply(s,event); assert.equal(view(s).distanceKm,15); assert.equal(view(s).partial,false); assert.deepEqual(apply(s,event),s);
});
test('40→38→40 conserva logros compartidos; cambiar meta no celebra ni pierde finish', () => {
 let s=apply(connected(),sync('slot-a',[a('x',40000)]));
 assert.deepEqual(view(s).unlockedMilestoneIds,['milestone-20','milestone-40']);
 s=apply(s,sync('slot-a',[a('x',38000)])); assert.equal(view(s).distanceKm,38); assert.ok(view(s).unlockedMilestoneIds.includes('milestone-40'));
 s=apply(s,sync('slot-a',[a('x',40000)])); assert.equal(view(s).unlockedMilestoneIds.length,2);
 s=apply(s,sync('slot-a',[a('x',500000)])); s.config.goalKm=700;
 assert.ok(view(s).unlockedMilestoneIds.includes('finish')); assert.equal(view(s).distanceKm,500);
 const otherClient=view(s); assert.deepEqual(view(s),otherClient); otherClient.unlockedMilestoneIds.length=0; assert.ok(view(s).unlockedMilestoneIds.includes('finish'));
});
test('revocación conserva agregado y cancela trabajos; reconexión reconcilia con generación nueva', () => {
 let s=apply(connected(),sync('slot-a',[a('x',40000)]));
 s=apply(s,{participantId:'slot-a',generation:0,status:'revoked'}); assert.equal(view(s).distanceKm,40); assert.equal(view(s).partial,true);
 assert.deepEqual(apply(s,sync('slot-a',[])),s);
 s=apply(s,{participantId:'slot-a',generation:1,status:'connected',scopes:['activity:read_all']});
 s=apply(s,sync('slot-a',[a('x',38000)],{generation:1})); assert.equal(view(s).distanceKm,38); assert.ok(view(s).unlockedMilestoneIds.includes('milestone-40'));
});
test('supresión verificada, idempotencia, no resurrección y purga de premios prioritaria', () => {
 let s=apply(apply(connected(),sync('slot-a',[a('x',40000)])),sync('slot-b',[a('x',60000)]));
 assert.throws(()=>apply(s,{participantId:'slot-a',generation:0,status:'deleted'}));
 const deletion={participantId:'slot-a',generation:0,status:'deleted',verified:true}; s=apply(s,deletion);
 assert.equal(view(s).distanceKm,60); assert.ok(view(s).unlockedMilestoneIds.includes('finish')); assert.deepEqual(apply(s,deletion),s);
 assert.deepEqual(apply(s,sync('slot-a',[a('resurrect',999999)],{generation:1})),s);
 s=apply(s,sync('slot-b',[a('x',50000)])); assert.equal(view(s).distanceKm,50);
 s=apply(s,{participantId:'slot-b',generation:0,status:'deleted',verified:true,purgeMilestones:true}); assert.deepEqual(view(s).unlockedMilestoneIds,[]);
 assert.deepEqual(Object.keys(view(s)).sort(),['distanceKm','partial','stale','updatedAt','unlockedMilestoneIds'].sort());
 assert.equal(JSON.stringify(view(s)).includes('slot-'),false);
});

test('revocación de snapshot cero conserva última fecha válida y marca parcial + stale', () => {
 let s=apply(connected(),sync('slot-a',[]));
 s=apply(s,{participantId:'slot-a',generation:0,status:'revoked'});
 assert.equal(view(s).updatedAt,'2026-11-02T12:00:00Z');
 assert.equal(view(s).partial,true); assert.equal(view(s).stale,true);
});

test('tras supresión solo consentimiento nuevo verificado habilita estado limpio y nueva generación', () => {
 let s=apply(connected(),sync('slot-a',[a('x',40000)]));
 s=apply(s,{participantId:'slot-a',generation:0,status:'deleted',verified:true});
 assert.deepEqual(apply(s,{participantId:'slot-a',generation:1,status:'connected',scopes:['activity:read_all']}),s);
 s=apply(s,{participantId:'slot-a',generation:1,status:'connected',scopes:['activity:read_all'],verified:true,newConsent:true});
 assert.equal(view(s).distanceKm,0); assert.equal(s.participants[0].generation,2);
 assert.deepEqual(apply(s,sync('slot-a',[a('old',50000)],{generation:1})),s);
 s=apply(s,sync('slot-a',[a('new',1000)],{generation:2})); assert.equal(view(s).distanceKm,1);
});
