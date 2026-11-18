import {prevision} from './prelevements.mjs';

const el = id => document.getElementById('ech-'+id);
const argent = cents => (cents/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
const jour = iso => new Date(iso+'T12:00:00').toLocaleDateString('fr-FR');
const element = (tag,texte) => {
    const node = document.createElement(tag);
    node.textContent = texte;
    return node;
};
function bouton(texte,action) {
    const node = element('button',texte);
    node.type = 'button';
    node.onclick = action;
    return node;
}

export function installerEcheancier(store,periode) {
    const collection = store.collection(null,'prelevements');
    let regles = [], ops = [], liens = {}, lignes = [];
    let edition, choix, precedent;
    function ouvrir(regle) {
        edition = regle?.id;
        el('titre').textContent = edition ? 'Modifier le prélèvement' : 'Ajouter un prélèvement';
        el('tiers').value = regle?.nom || '';
        el('montant').value = regle ? regle.cents/100 : '';
        el('debut').value = regle?.premiere || new Date().toLocaleDateString('sv-SE');
        el('dialog').showModal();
    }
    function associer(ligne) {
        choix = ligne.id;
        precedent = liens[choix] ?? null;
        const prises = new Set([...Object.values(liens),...lignes.map(l=>l.operation?.id)]);
        const {debut,finExclusive} = periode();
        const bord = new Date(debut+'T12:00:00Z');
        bord.setUTCDate(bord.getUTCDate()-7);
        const fin = new Date(finExclusive+'T12:00:00Z');
        fin.setUTCDate(fin.getUTCDate()+7);
        const min = bord.toISOString().slice(0,10), max = fin.toISOString().slice(0,10);
        const candidates = ops.filter(op=>op.X!=='x' && nombre(op.Dépenses)>0 && !prises.has(op.id) && op.Date>=min && op.Date<max);
        candidates.sort((a,b)=>Math.abs(Date.parse(a.Date)-Date.parse(ligne.date))-Math.abs(Date.parse(b.Date)-Date.parse(ligne.date))||a.id.localeCompare(b.id));
        el('reference').textContent = ligne.regle.nom+' · '+jour(ligne.date)+' · '+argent(ligne.regle.cents);
        const select = el('op');
        select.replaceChildren(new Option(candidates.length?'Choisir une opération':'Aucune dépense disponible sur la période', ''));
        for (const op of candidates) select.add(new Option(jour(op.Date)+' · '+op.Tiers+' · '+argent(Math.round(nombre(op.Dépenses)*100)),op.id));
        el('lien-form').querySelector('[type=submit]').disabled = !candidates.length;
        el('lien').showModal();
    }
    function nombre(value) { return Number(String(value || 0).replace(/\s/g,'').replace(',','.')); }
    async function enregistrer(form,action,dialog) {
        const submit = form.querySelector('[type=submit]');
        if (submit.disabled) return;
        submit.disabled = true;
        try { await action(); dialog.close(); }
        catch(error) { alert(error.message); }
        finally { submit.disabled = false; }
    }
    el('ajouter').onclick = ()=>ouvrir();
    el('annuler').onclick = ()=>el('dialog').close();
    el('fermer').onclick = ()=>el('lien').close();
    el('form').onsubmit = event=>{
        event.preventDefault();
        const data = {nom:el('tiers').value.trim(),cents:Math.round(el('montant').valueAsNumber*100),premiere:el('debut').value};
        if (!data.nom || !Number.isSafeInteger(data.cents) || data.cents<=0) return alert('Vérifie le fournisseur et le montant.');
        enregistrer(event.currentTarget,()=>edition?store.updateDoc(store.doc(null,'prelevements',edition),data):store.addDoc(collection,data),el('dialog'));
    };
    el('lien-form').onsubmit = event=>{
        event.preventDefault();
        enregistrer(event.currentTarget,()=>store.lier({echeance:choix,operation:el('op').value,precedent}),el('lien'));
    };
    function afficher() {
        const bornes = periode();
        const resultat = prevision(regles,ops,liens,bornes);
        lignes = resultat.dates;
        el('borne').textContent = 'Avant la paie du '+jour(bornes.finExclusive);
        el('restant').textContent = argent(resultat.restant);
        el('solde').textContent = argent(resultat.projete);
        const liste = el('liste');
        liste.replaceChildren();
        if (!lignes.length) liste.append(element('p',regles.length?'Aucune échéance sur cette période.':'Ajoute ton premier prélèvement mensuel pour calculer le solde prévu.'));
        for (const ligne of lignes) {
            const card = document.createElement('article');
            card.className = 'echeance';
            card.append(element('h3',ligne.regle.nom),element('p',jour(ligne.date)+' · '+argent(ligne.regle.cents)));
            const op = ligne.operation;
            if (op) card.append(element('p',(ligne.manuel?'Dépense associée':'Dépense reconnue')+' · '+jour(op.Date)+' · '+op.Tiers+' · '+argent(Math.round(nombre(op.Dépenses)*100))));
            else card.append(element('p','À prélever'),bouton('Associer une dépense',()=>associer(ligne)));
            if (ligne.manuel) card.append(bouton('Retirer le lien',async()=>{
                try { await store.lier({echeance:ligne.id,operation:null,precedent:liens[ligne.id]}); }
                catch(error) { el('message').textContent = error.message; }
            }));
            liste.append(card);
        }
        el('regles').replaceChildren();
        for (const regle of regles) {
            const div = document.createElement('div');
            div.className = 'regle';
            div.append(element('p',regle.nom+' · '+argent(regle.cents)+' · le '+Number(regle.premiere.slice(8))),
                bouton('Modifier',()=>ouvrir(regle)),bouton('Supprimer',async()=>{
                    if (!confirm('Supprimer le prélèvement mensuel « '+regle.nom+' » ? Les dépenses saisies seront conservées.')) return;
                    try { await store.supprimerRegle(regle.id); }
                    catch(error) { el('message').textContent = error.message; }
                }));
            el('regles').append(div);
        }
    }
    store.onSnapshot(collection,snap=>{
        regles = snap.docs.filter(d=>d.id!=='rapprochements').map(d=>({...d.data(),id:d.id})).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
        liens = snap.docs.find(d=>d.id==='rapprochements')?.data() || {};
        afficher();
    });
    store.onSnapshot(store.collection(null,'operations'),snap=>{
        ops = snap.docs.map(d=>({...d.data(),id:d.id}));
        afficher();
    });
    el('gestion').open = !regles.length;
    return afficher;
}
