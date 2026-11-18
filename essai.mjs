import {cleFournisseur} from './fournisseurs.mjs';
// Les données sources servent de référence. Les écritures passent exclusivement par le stockage de l'essai.
export const tables = ['operations', 'enveloppes', 'cartes'];
export const tableNoms = 'nomsFournisseurs';
function lotDuFournisseur(id) {
  let hash = 5381;
  for (const caractere of id) hash = Math.imul(hash,33) ^ caractere.codePointAt(0);
  return String(hash & 63);
}
export const keyOf = (table,id) => JSON.stringify([table,id]);
export function newValue(current, action) {
  if (action.type === 'noms') {
    const lot = {...current};
    for (const changement of action.data) {
      const key = 'op_' + changement.id;
      const avant = lot[key];
      if (changement.effacer) { delete lot[key]; continue; }
      const attendu = changement.attendu;
      if (avant?.nom !== attendu?.nom || avant?.origine !== attendu?.origine)
        throw Error('Ce fournisseur a changé. Vérifie le nombre d’écritures puis confirme à nouveau.');
      lot[key] = {origine:changement.origine, nom:changement.nom};
    }
    return Object.keys(lot).length ? lot : current == null ? current : {};
  }
  if (action.type === 'create' && current != null && !current.deleted) throw Error('Une enveloppe porte déjà ce nom.');
  if (action.type === 'delete') return null;
  if (action.type === 'update' && current == null) throw Error('Cette entrée a été supprimée.');
  return action.type === 'update' ? {...current,...action.data} : action.data;
}
export function browserDrafts(storage, key) {
  let memory = new Map();
  function read() {
    return storage ? new Map(JSON.parse(storage.getItem(key) || '[]')) : new Map(memory);
  }
  function persist(drafts) {
    if (storage) storage.setItem(key,JSON.stringify([...drafts]));
    else memory=drafts;
  }
  function withLock(work) {
    return storage && globalThis.navigator?.locks ? navigator.locks.request(key,work) : work();
  }
  return {
    // Une écriture dans un autre onglet attend la fin de cette reprise.
    async resume(upload) {
      return withLock(async () => {
        // Reprendre les lots de fournisseurs ensemble (64 au maximum).
        const pending=new Map([...read()].sort(([a],[b]) =>
          Number(JSON.parse(b)[0]===tableNoms)-Number(JSON.parse(a)[0]===tableNoms)));
        while (pending.size) {
          const group=[...pending].slice(0,100);
          await upload(group);
          for (const [id] of group) pending.delete(id);
          persist(pending);
        }
      });
    },
    read, watch(notify) {
      const changed = event => { if(event.key === key) notify(read()); };
      globalThis.addEventListener?.('storage',changed);
      return () => globalThis.removeEventListener?.('storage',changed);
    },
    async apply(actions,base) {
      const commit = () => {
        const drafts=read();
        for (const action of actions) {
          const {table,id}=action.ref, k=keyOf(table,id);
          const previous=drafts.has(k)?drafts.get(k):base[table].get(id);
          const value=newValue(previous,action);
          if (JSON.stringify(previous)!==JSON.stringify(value)) drafts.set(k,value);
        }
        persist(drafts);
        return drafts;
      };
      return withLock(commit);
    }
  };
}
export function accountDrafts(storage, projectId, uid) {
  if (!uid || !projectId) throw Error('Compte Firebase manquant.');
  return browserDrafts(storage,'b2.essai.compte.v1.' + JSON.stringify([projectId,uid]));
}
export function createStore(base, backend, onError) {
  base = {...base,[tableNoms]:base[tableNoms] || new Map()};
  let drafts=backend.read(), queue=Promise.resolve();
  const listeners=new Set();
  function lotCourant(lot) {
    const key = keyOf(tableNoms,lot);
    return drafts.has(key) ? drafts.get(key) : base[tableNoms].get(lot);
  }
  function donneesBrutes(nomTable) {
    const records=new Map(base[nomTable]);
    for (const [k,value] of drafts) {
      const [table,id]=JSON.parse(k);
      if (table!==nomTable) continue;
      if (value===null) records.delete(id); else records.set(id,value);
    }
    return records;
  }
  function nomAffiche(id,op) {
    const correction = lotCourant(lotDuFournisseur(id))?.['op_'+id];
    return correction && op.Tiers === correction.origine ? correction.nom : op.Tiers;
  }
  function snapshot(q) {
    let rows=[...donneesBrutes(q.table)];
    if (q.table==='operations') rows=rows.map(([id,op])=>[id,{...op,Tiers:nomAffiche(id,op)}]);
    if(q.field) {
      rows=rows.filter(([,v])=>v[q.field]!==undefined);
      rows.sort(([a,x],[b,y])=>((x[q.field]<y[q.field]?-1:x[q.field]>y[q.field]?1:a.localeCompare(b))*(q.direction==='desc'?-1:1)));
    }
    if(q.count!=null) rows=rows.slice(0,q.count);
    const docs=rows.map(([id,value])=>({id,data:()=>({...value})}));
    return {docs,empty:!docs.length,forEach:fn=>docs.forEach(fn),metadata:{hasPendingWrites:false}};
  }
  function publish(updated) {
    drafts=updated;
    for (const {q,callback} of listeners) callback(snapshot(q));
  }
  const stop=backend.watch(publish,onError);
  function actionsNoms(changements) {
    const lots=new Map();
    for (const changement of changements) {
      const lot=lotDuFournisseur(changement.id);
      if (!lots.has(lot)) lots.set(lot,[]);
      lots.get(lot).push(changement);
    }
    return [...lots].map(([id,data])=>({type:'noms',ref:{table:tableNoms,id},data}));
  }
  function preparerRenommage(source,nom) {
    const cle=cleFournisseur(source);
    const changements=[];
    if (!cle || !nom.trim()) return changements;
    for (const [id,op] of donneesBrutes('operations')) {
      const actuel=nomAffiche(id,op);
      if (typeof actuel!=='string' || cleFournisseur(actuel)!==cle || actuel===nom) continue;
      changements.push({id,origine:op.Tiers,nom,attendu:lotCourant(lotDuFournisseur(id))?.['op_'+id]});
    }
    return changements;
  }
  function enqueue(preparer) {
    const task=queue.then(async()=>{
      publish(await backend.apply(preparer(),base));
    });
    queue=task.catch(()=>{});
    return task;
  }
  function write(actions) {
    const effacements=actions.filter(a=>a.ref.table==='operations' &&
      (a.type!=='update' || Object.hasOwn(a.data,'Tiers'))).map(a=>({id:a.ref.id,effacer:true}));
    return enqueue(()=>[...actions,...actionsNoms(effacements)]);
  }
  const doc=(_,table,id)=>{
    if (!tables.includes(table) || !id || typeof id!=='string' || id.includes('/')) throw Error('Identifiant invalide.');
    return {table,id};
  };
  const action=(ref,data,type)=>({ref,data,type});
  return {
    preparerRenommage,
    renommerFournisseur(source,nom,apercu) {
      return enqueue(()=>{
        const actuel=preparerRenommage(source,nom);
        const ids=new Set(apercu.map(c=>c.id));
        if (!actuel.length || actuel.length!==ids.size || actuel.some(c=>!ids.has(c.id)))
          throw Error('La liste des écritures a changé. Vérifie le total puis confirme à nouveau.');
        return actionsNoms(actuel);
      });
    },
    db:null,doc,collection:(_,table)=>({table}),query:(q,...parts)=>Object.assign({},q,...parts),
    orderBy:(field,direction)=>({field,direction}),limit:count=>({count}),
    getDocs:async q=>snapshot(q),
    onSnapshot(q,...args) {
      const callback=typeof args[0]==='function'?args[0]:args[1];
      const entry={q,callback}; listeners.add(entry);callback(snapshot(q));
      return ()=>listeners.delete(entry);
    },
    setDoc:(ref,data,options)=>write([action(ref,data,options?.merge?'update':'set')]),
    updateDoc:(ref,data)=>write([action(ref,data,'update')]),
    deleteDoc:ref=>write([action(ref,null,'delete')]),
    addDoc:async(q,data)=>{const ref=doc(null,q.table,crypto.randomUUID());await write([action(ref,data,'set')]);return ref;},
    writeBatch() {
      const actions=[];
      return {create:(ref,data)=>actions.push(action(ref,data,'create')),set:(ref,data)=>actions.push(action(ref,data,'set')),update:(ref,data)=>actions.push(action(ref,data,'update')),commit:()=>write(actions)};
    },
    close(){listeners.clear();stop();}
  };
}
export function demoStore(){
  const base=Object.fromEntries(tables.map(t=>[t,new Map()]));
  const day=new Date().toLocaleDateString('sv-SE');
  base.operations.set('exemple-recette',{Date:day,Tiers:'Solde de démonstration',Recettes:1000,Dépenses:'','E/C':'CB',P:'',V:'',X:''});
  return createStore(base,browserDrafts(localStorage,'b2.essai.demo.v1'));
}
