import assert from 'node:assert/strict';
import test from 'node:test';
import {createStore,browserDrafts,tables} from '../essai.mjs';

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
