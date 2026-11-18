import test from 'node:test';
import assert from 'node:assert/strict';
import {prevision} from '../prelevements.mjs';
import {createStore,browserDrafts,tables} from '../essai.mjs';

const r = {id:'r',nom:'Eau',premiere:'2026-10-20',cents:2500};
const periode = {debut:'2026-10-28',finExclusive:'2026-11-28'};
const op = {id:'o',Date:'2026-11-20',Tiers:' EAU ',Dépenses:'25,00'};
const calcul = (regles,ops=[],liens={})=>prevision(regles,[{Recettes:1000},...ops],liens,periode);
test('projection avant et après saisie du débit exact',()=>{
    const avant=calcul([r]), apres=calcul([r],[op]);
    assert.equal(avant.restant,2500);
    assert.equal(apres.restant,0);
    assert.equal(avant.projete,97500);
    assert.equal(apres.projete,97500);
    assert.equal(apres.dates[0].operation.id,'o');
});
test('les doublons restent à rapprocher et un lien ne consomme qu’une seule échéance',()=>{
    const r2={...r,id:'r2'};
    assert.equal(calcul([r,r2],[op]).restant,5000);
    assert.equal(calcul([r],[op,{...op,id:'o2'}]).restant,2500);
    assert.equal(calcul([r,r2],[op],{'r:2026-11':'o'}).restant,2500);
});
test('un débit décalé ou variable peut être associé, puis exclu ou supprimé',()=>{
    const variable={...op,Date:'2026-11-22',Dépenses:'27,43'};
    const liens={'r:2026-11':'o'};
    assert.equal(calcul([r],[variable],liens).projete,97257);
    assert.equal(calcul([r],[{...variable,X:'x'}],liens).projete,97500);
    assert.equal(calcul([r],[],liens).restant,2500);
});
test('derniers jours du mois, paie anticipée, première échéance et borne exclusive',()=>{
    const regles=[{...r,premiere:'2024-01-31'},{...r,id:'future',premiere:'2027-05-20'}];
    for(const [fin,attendu] of [['2024-03-28','2024-02-29'],['2025-03-28','2025-02-28']]){
        const annee=fin.slice(0,4);
        assert.deepEqual(prevision(regles,[],{},{debut:annee+'-02-25',finExclusive:fin}).dates.map(d=>d.date),[attendu]);
    }
    const dates=prevision([r],[],{},{debut:'2026-11-18',finExclusive:'2026-12-28'}).dates;
    assert.deepEqual(dates.map(d=>d.date),['2026-11-20','2026-12-20']);
    assert.equal(calcul([{...r,premiere:'2026-11-28'}]).dates.length,0);
});
test('liens persistants, contrôle des conflits et suppression d’une règle',async()=>{
    const base=Object.fromEntries(tables.map(t=>[t,new Map()]));
    const backend=browserDrafts(null);
    const store=createStore(base,backend);
    await store.setDoc(store.doc(null,'prelevements','r'),r);
    await store.lier({echeance:'r:2026-11',operation:'o',precedent:null});
    await assert.rejects(store.lier({echeance:'r2:2026-11',operation:'o',precedent:null}));
    await assert.rejects(store.lier({echeance:'r:2026-11',operation:'o2',precedent:null}));
    store.close();
    const autre=createStore(base,backend);
    const liste=()=>autre.getDocs(autre.collection(null,'prelevements'));
    assert.equal((await liste()).docs.find(d=>d.id==='rapprochements').data()['r:2026-11'],'o');
    await autre.supprimerRegle('r');
    assert.deepEqual((await liste()).docs.map(d=>d.data()),[{}]);
});
