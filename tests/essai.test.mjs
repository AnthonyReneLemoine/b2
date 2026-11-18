import assert from 'node:assert/strict';
import test from 'node:test';
import {createStore,browserDrafts,accountDrafts,tables} from '../essai.mjs';

function fixture() {
  const base=Object.fromEntries(tables.map(t=>[t,new Map()]));
  base.enveloppes.set('courses',{montant:150,reste:150});
  base.operations.set('initial',{Date:'2026-11-18',Recettes:1000});
  const store=createStore(base,browserDrafts(null));
  return {base,store};
}
test('le recalcul, le changement de paie et la suppression restent dans l’essai', async()=>{
  const {base,store}=fixture();
  const envelope=store.doc(null,'enveloppes','courses');
  await store.updateDoc(envelope,{reste:125});
  const batch=store.writeBatch();
  batch.set(store.doc(null,'enveloppes','b2-pay-period'),{debut:'2026-11-18'});
  batch.update(envelope,{reste:150});await batch.commit();
  await store.deleteDoc(store.doc(null,'operations','initial'));
  assert.equal((await store.getDocs(store.collection(null,'operations'))).empty,true);
  assert.equal((await store.getDocs(store.collection(null,'enveloppes'))).docs.length,2);
  assert.deepEqual([...base.enveloppes],[['courses',{montant:150,reste:150}]]);
  assert.equal(base.operations.get('initial').Recettes,1000);
});
test('un lot invalide ne laisse aucune écriture partielle',async()=>{
  const {store}=fixture(), batch=store.writeBatch();
  batch.update(store.doc(null,'enveloppes','courses'),{reste:0});
  batch.update(store.doc(null,'enveloppes','absente'),{reste:0});
  await assert.rejects(()=>batch.commit(),/supprimée/);
  const {docs}=await store.getDocs(store.collection(null,'enveloppes'));
  assert.equal(docs[0].data().reste,150);
});
test('les opérations ajoutées sont visibles par date et conservées entre ouvertures',async()=>{
  const {base}=fixture(),values=new Map();
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const open=()=>createStore(base,browserDrafts(storage,'test'));
  const store=open();
  const ops=store.collection(null,'operations');
  await store.addDoc(ops,{Date:'2026-11-19',Dépenses:12.5});
  store.close();
  const reopened=open();
  const last=await reopened.getDocs(reopened.query(ops,reopened.orderBy('Date','desc'),reopened.limit(1)));
  assert.equal(last.docs[0].data().Dépenses,12.5);
  assert.equal(base.operations.size,1);
});

test('l’essai connecté reste disponible après fermeture et reste propre au compte',async()=>{
  const {base}=fixture(), values=new Map();
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const open=uid=>createStore(base,accountDrafts(storage,'banque-test',uid));
  const first=open('compte-A');
  await first.addDoc(first.collection(null,'operations'),{Date:'2026-11-20',Dépenses:15});
  first.close();
  const reopened=open('compte-A'), other=open('compte-B');
  assert.equal((await reopened.getDocs(reopened.collection(null,'operations'))).docs.length,2);
  assert.equal((await other.getDocs(other.collection(null,'operations'))).docs.length,1);
});
test('une reprise interrompue conserve les lignes locales restant à synchroniser',async()=>{
  const {base}=fixture(), local=browserDrafts(null);
  const entries=Array.from({length:101},(_,i)=>({ref:{table:'operations',id:'test-'+i},type:'set',data:{Recettes:i}}));
  await local.apply(entries,base);
  let batches=0;
  await assert.rejects(()=>local.resume(async group=>{
    if(++batches===2)throw Error('Accès refusé');
    assert.equal(group.length,100);
  }),/Accès refusé/);
  assert.equal(local.read().size,1);
  await local.resume(async group=>assert.equal(group.length,1));
  assert.equal(local.read().size,0);
});

test('renommage global atomique, persistant et limité aux écritures sélectionnées',async()=>{
  const {base}=fixture(), backend=browserDrafts(null);
  for (let i=0;i<810;i++) base.operations.set('op'+i,{
    Tiers:i%2?'CAFÉ  SAS':' café sas ',Date:i%3?'2024-01-02':'2026-11-19',
    Recettes:i%2?10:'',Dépenses:i%2?'':25,X:i%4?'':'x',note:'cafÉ sas'
  });
  base.operations.set('autre',{Tiers:'Café SAS Nord'});
  base.operations.set('existant',{Tiers:'Maison'});
  const store=createStore(base,backend), ops=store.collection(null,'operations');
  const apercu=store.preparerRenommage('Café sas','Maison');
  assert.equal(apercu.length,810);
  const observations=[];
  store.onSnapshot(ops,s=>observations.push(s.docs.filter(d=>d.data().Tiers==='Maison').length));
  await store.renommerFournisseur('Café sas','Maison',apercu);
  assert.deepEqual(observations,[1,811]);
  assert.ok(backend.read().size<=64);
  const reopened=createStore(base,backend);
  const get=async id=>(await reopened.getDocs(ops)).docs.find(d=>d.id===id).data();
  assert.deepEqual(await get('op1'),{...base.operations.get('op1'),Tiers:'Maison'});
  assert.equal((await get('autre')).Tiers,'Café SAS Nord');
  await reopened.updateDoc(reopened.doc(null,'operations','op0'),{P:'x'});
  assert.equal((await get('op0')).Tiers,'Maison');
  await reopened.updateDoc(reopened.doc(null,'operations','op0'),{Tiers:' café sas '});
  const nouvel=await reopened.addDoc(ops,{Tiers:'Café sas'});
  const deuxieme=reopened.preparerRenommage('maison','MAISON');
  assert.equal(deuxieme.length,810);
  await reopened.renommerFournisseur('maison','MAISON',deuxieme);
  assert.equal((await get('op1')).Tiers,'MAISON');
  assert.equal((await get('op0')).Tiers,' café sas ');
  assert.equal((await get(nouvel.id)).Tiers,'Café sas');
  const avant=reopened.preparerRenommage('maison','Final');
  await reopened.deleteDoc(reopened.doc(null,'operations','op1'));
  await assert.rejects(reopened.renommerFournisseur('maison','Final',avant),/liste des écritures/);
  assert.equal((await get('op2')).Tiers,'MAISON');
});
