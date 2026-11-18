import {prevision, prochaineSaisie} from './prelevements.mjs';

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

export function installerEcheancier(store,periode,apresSaisie) {
    const collection = store.collection(null,'prelevements');
    let regles = [], ops = [], liens = {}, lignes = [];
    let edition, actif = false, enCours = false;
    const aujourdhui = ()=>new Date().toLocaleDateString('sv-SE');
    function correspondance(regle,date,creation=false) {
        const fin = new Date(date+'T12:00:00Z');
        fin.setUTCDate(fin.getUTCDate()+1);
        const bornes = {debut:date,finExclusive:fin.toISOString().slice(0,10)};
        const modeles = creation ? [...regles,regle] : regles;
        const ligne = prevision(modeles,ops,liens,bornes).dates.find(l=>l.regle.id===regle.id);
        return ligne?.operation?.id;
    }
    async function rattraper() {
        if (!actif || enCours) return;
        enCours = true;
        let modifie = false;
        try {
            for (;;) {
                const debut = periode().debut, jourCourant = aujourdhui();
                const regle = regles.find(r=>prochaineSaisie(r,jourCourant,debut));
                if (!regle) break;
                const date = prochaineSaisie(regle,jourCourant,debut);
                await store.saisirEcheance(regle,date,correspondance(regle,date));
                modifie = true;
            }
        } catch(error) {
            if (error.code !== 'echeance-modifiee') el('message').textContent = error.message;
        } finally {
            enCours = false;
            if (modifie) await apresSaisie();
        }
    }
    function ouvrir(regle) {
        edition = regle?.id;
        el('titre').textContent = edition ? 'Modifier le prélèvement' : 'Ajouter un prélèvement';
        el('tiers').value = regle?.nom || '';
        el('montant').value = regle ? regle.cents/100 : '';
        el('debut').value = regle?.premiere || new Date().toLocaleDateString('sv-SE');
        el('dialog').showModal();
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
    el('form').onsubmit = event=>{
        event.preventDefault();
        const data = {nom:el('tiers').value.trim(),cents:Math.round(el('montant').valueAsNumber*100),premiere:el('debut').value};
        if (!data.nom || !Number.isSafeInteger(data.cents) || data.cents<=0) return alert('Vérifie le fournisseur et le montant.');
        enregistrer(event.currentTarget,async()=>{
            if (edition) await store.updateDoc(store.doc(null,'prelevements',edition),data);
            else {
                const regle = {...data,id:crypto.randomUUID()};
                await store.saisirEcheance(regle,data.premiere,correspondance(regle,data.premiere,true),true);
                await apresSaisie();
            }
        },el('dialog'));
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
            if (op) {
                card.append(element('p','Dans l’historique · '+jour(op.Date)+' · '+op.Tiers+' · '+argent(Math.round(nombre(op.Dépenses)*100))),
                    bouton('Modifier la dépense',()=>window.openOpModal(op.id,op)));
            } else card.append(element('p',ligne.saisie?'Dépense supprimée':'Saisie automatique à l’échéance'));
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
            const premiere = ops.find(op=>op.echeanceId===regle.id+':'+regle.premiere.slice(0,7));
            if (premiere && !lignes.some(l=>l.operation?.id===premiere.id) && premiere.Date>=aujourdhui()) {
                div.append(bouton('Modifier la première dépense',()=>window.openOpModal(premiere.id,premiere)));
            }
            el('regles').append(div);
        }
    }
    store.onSnapshot(collection,snap=>{
        regles = snap.docs.filter(d=>d.id!=='rapprochements').map(d=>({...d.data(),id:d.id})).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));
        liens = snap.docs.find(d=>d.id==='rapprochements')?.data() || {};
        afficher();
        queueMicrotask(rattraper);
    });
    store.onSnapshot(store.collection(null,'operations'),snap=>{
        ops = snap.docs.map(d=>({...d.data(),id:d.id}));
        afficher();
    });
    el('gestion').open = !regles.length;
    return {
        afficher,
        demarrer() {
            actif = true;
            let dernierJour = aujourdhui();
            const verifierJour = ()=>{
                const date = aujourdhui();
                if (date !== dernierJour) {
                    dernierJour = date;
                    afficher();
                    apresSaisie();
                }
                rattraper();
            };
            window.addEventListener('focus',verifierJour);
            window.setInterval(verifierJour,60000);
            return rattraper();
        }
    };
}
