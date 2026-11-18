import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore, collection, getDocsFromServer, doc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {tables, tableNoms, keyOf, newValue, createStore, accountDrafts} from './essai.mjs';
        const firebaseConfig = {
            apiKey: "AIzaSyABmCu61-jScR4yDAqFKJ_RXwcKAmok4pg",
            authDomain: "banque-3fd70.firebaseapp.com",
            projectId: "banque-3fd70",
            storageBucket: "banque-3fd70.firebasestorage.app",
            messagingSenderId: "892055695539",
            appId: "1:892055695539:web:731b02c49224949ba1c0c6"
        };
const app=initializeApp(firebaseConfig), auth=getAuth(app), db=getFirestore(app);
export const google=()=>{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});return signInWithPopup(auth,provider);};
export const password=(email,pwd)=>signInWithEmailAndPassword(auth,email,pwd);
export const logout=()=>signOut(auth);
export const observe=fn=>onAuthStateChanged(auth,fn);
const draftMap=snapshot=>new Map(snapshot.docs.map(d=>{const {table,id,value}=d.data();return [keyOf(table,id),value];}));
function cloudDrafts(ref,snapshot) {
  let cache=draftMap(snapshot);
  return {
    read:()=>cache,
    watch(notify,fail){return onSnapshot(ref,snap=>{
      if(snap.metadata.hasPendingWrites)return;
      cache=draftMap(snap);notify(cache);
    },fail);},
    async apply(actions,base){
      const changes=await runTransaction(db,async tx=>{
        const records=await Promise.all(actions.map(async a=>{
          const {table,id}=a.ref;
          const path=doc(ref,table+'-'+id);
          const before=await tx.get(path);
          const original=before.exists()?before.data().value:base[table].get(id);
          const value=newValue(original,a);
          return {path,table,id,value,changed:JSON.stringify(original)!==JSON.stringify(value)};
        }));
        for(const {path,table,id,value,changed} of records) if(changed) tx.set(path,{table,id,value});
        return records.filter(r=>r.changed);
      });
      for(const {table,id,value} of changes) cache.set(keyOf(table,id),value);
      return new Map(cache);
    }
  };
}
export async function connectedStore(user,onError) {
  // Les trois collections du site d’origine ne sont utilisées qu’en lecture.
  const rows=await Promise.all(tables.map(async table=>{
    const snap=await getDocsFromServer(collection(db,table));
    return [table,new Map(snap.docs.map(d=>[d.id,d.data()]))];
  }));
  const base={...Object.fromEntries(rows),[tableNoms]:new Map()};
  const ref=collection(db,'b2_essais',user.uid,'modifications');
  const local=accountDrafts(localStorage,firebaseConfig.projectId,user.uid);
  let baseline;
  let recovered;
  try {
    baseline=await getDocsFromServer(ref);
    if (local.read().size) {
      recovered=draftMap(baseline);
      await local.resume(async group=>{
        await restoreDrafts(ref,group);
        for (const [key,value] of group) recovered.set(key,value);
      });
      baseline=await getDocsFromServer(ref);
    }
    return {store:createStore(base,cloudDrafts(ref,baseline),onError),label:'Essai Firebase synchronisé'};
  } catch(error) {
    if (error.code!=='permission-denied' && error.code!=='draft-conflict') throw error;
    // Inclure les lots déjà repris si un lot ultérieur a échoué.
    if (recovered) {
      for (const [key,value] of recovered) {
        const [table,id]=JSON.parse(key);
        if(value===null) base[table].delete(id); else base[table].set(id,value);
      }
    }
    const label=error.code==='draft-conflict'
      ? 'Sauvegarde sur cet appareil · Une modification différente existe déjà sur Firebase.'
      : 'Sauvegarde sur cet appareil';
    return {store:createStore(base,local,onError),label,needsRule:error.code==='permission-denied'};
  }
}
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])]));
  return value;
}
async function restoreDrafts(ref,group) {
  await runTransaction(db,async tx=>{
    const records=await Promise.all(group.map(async ([key,value])=>{
      const [table,id]=JSON.parse(key);
      if ((!tables.includes(table) && table!==tableNoms) || !id || typeof id!=='string' || id.includes('/')) throw Error('Modification locale invalide.');
      const path=doc(ref,table+'-'+id);
      const snapshot=await tx.get(path);
      if (snapshot.exists() && JSON.stringify(ordered(snapshot.data().value)) !== JSON.stringify(ordered(value))) {
        const error=Error('Versions locale et distante différentes.');
        error.code='draft-conflict';
        throw error;
      }
      return {path,exists:snapshot.exists(),data:{table,id,value}};
    }));
    for (const record of records) if(!record.exists) tx.set(record.path,record.data);
  });
}
