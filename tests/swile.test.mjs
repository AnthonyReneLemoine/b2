import test from 'node:test';
import assert from 'node:assert/strict';
import {bilanSwile,centimesSwile,verifierMouvement,jourSwile} from '../swile.mjs';
import {browserDrafts,createStore,tables} from '../essai.mjs';

const carte={initial:7200,utilise:0,date:'2026-11-18'};
const mouvement=(montant,date,type='depense')=>({type,montant,date,tiers:'Cantine',saisie:date+'T12:00:00Z'});

test('disponible en centimes selon le jour, le plafond et le solde réel',()=>{
  const lundi='2026-11-18', mardi='2026-11-19';
  const depenses=[mouvement(1245,lundi),mouvement(1055,lundi),mouvement(800,mardi)];
  assert.deepEqual(bilanSwile(carte,depenses,lundi),{solde:4900,disponible:200});
  assert.deepEqual(bilanSwile(carte,depenses,mardi),{solde:4100,disponible:1700});
  assert.equal(bilanSwile({...carte,initial:3000},depenses.slice(0,2),mardi).disponible,700);
  assert.deepEqual(bilanSwile({...carte,utilise:2500},[],lundi),{solde:7200,disponible:0});
  assert.equal(bilanSwile({...carte,utilise:2500},[],mardi).disponible,2500);
  assert.equal(centimesSwile('0,29'),29);
  assert.throws(()=>centimesSwile('12.345'));
  assert.throws(()=>verifierMouvement(carte,depenses,mouvement(201,lundi),mardi),/plafond/);
  assert.throws(()=>verifierMouvement(carte,[],mouvement(100,'2026-11-20'),mardi),/date/);
  assert.throws(()=>verifierMouvement(carte,[],mouvement(100,'2026-11-17'),mardi),/date/);
  assert.throws(()=>verifierMouvement({...carte,initial:1000},[mouvement(900,mardi)],mouvement(200,lundi),mardi),/négatif/);
  assert.equal(bilanSwile(carte,[...depenses,mouvement(2000,mardi,'recharge')],mardi).disponible,1700);
});

test('persistance et écritures concurrentes sans double débit ni effet bancaire',async()=>{
  const base=Object.fromEntries(tables.map(t=>[t,new Map()]));
  const backend=browserDrafts(null);
  const budget=createStore(base,backend);
  const date=jourSwile();
  await budget.ouvrirSwile({...carte,date,initial:2400});
  const second=createStore(base,backend);
  await assert.rejects(second.ouvrirSwile({...carte,date}),/déjà enregistré/);
  await budget.saisirSwile(mouvement(2300,date));
  await assert.rejects(second.saisirSwile(mouvement(150,date)),/autre appareil/);
  await assert.rejects(budget.saisirSwile(mouvement(150,date)),/insuffisant/);
  await budget.saisirSwile(mouvement(100,date));
  const rouvert=createStore(base,backend);
  const lignes=(await rouvert.getDocs({table:'swile'})).docs;
  assert.equal(lignes.length,3);
  assert.deepEqual(bilanSwile(lignes.find(x=>x.id==='carte').data(),lignes.filter(x=>x.id!=='carte').map(x=>x.data()),date),{solde:0,disponible:0});
  for (const table of tables) assert.equal((await rouvert.getDocs({table})).empty,true);
});
