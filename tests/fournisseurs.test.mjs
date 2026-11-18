import test from 'node:test';
import assert from 'node:assert/strict';
import {fournisseursFrequents} from '../fournisseurs.mjs';

const achat=(Tiers,Date='2026-11-05',montant=1)=>({Tiers,Date,'Dépenses':montant});
const date='2026-11-18';
test('les dix dépenses du nouveau fournisseur le font entrer dans les cinq du mois',()=>{
    const ops=['A','B','C','D','E'].map(n=>achat(n));
    assert.deepEqual(fournisseursFrequents(ops,date),['A','B','C','D','E']);
    ops.push(...Array.from({length:10},()=>achat('Nouveau')));
    assert.deepEqual(fournisseursFrequents(ops,date),['Nouveau','A','B','C','D']);
});
test('regroupe les variantes, compte les dépenses et écarte les recettes et exclusions',()=>{
    const ops=[achat(' Drive  Leclerc '),achat('drive leclerc','2026-11-06','2,50'),achat('Autre',date,150),
        achat('  '),{...achat('Exclu'),X:'x'},{Tiers:'Salaire',Date:date,Recettes:2000}];
    assert.deepEqual(fournisseursFrequents(ops,date),['drive leclerc','Autre']);
    assert.deepEqual(fournisseursFrequents([],date),[]);
});
test('complète avec les mois précédents et recalcule au changement de mois',()=>{
    const ops=[achat('Ancien','2026-10-02'),achat('Ancien','2026-10-03'),achat('Actuel'),achat('Futur','2026-12-20')];
    assert.deepEqual(fournisseursFrequents(ops,date),['Actuel','Ancien']);
    assert.deepEqual(fournisseursFrequents(ops,'2026-10-10'),['Ancien']);
    assert.deepEqual(fournisseursFrequents(ops,'2026-12-01'),['Futur','Ancien','Actuel']);
});
