const monthKey = date => date.slice(0,7);
const trimName = text => String(text ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase('fr');
const centimes = value => Math.round(Number(String(value || 0).replace(/\s/g,'').replace(',','.')) * 100) || 0;

function dateDuMois(premiere, mois) {
    const fin = new Date(mois+'-01T12:00:00Z');
    fin.setUTCMonth(fin.getUTCMonth()+1,0);
    return mois+'-'+String(Math.min(Number(premiere.slice(8)),fin.getUTCDate())).padStart(2,'0');
}

export function prochaineSaisie(regle, aujourdHui, debutPeriode) {
    // Les anciens modèles démarrent dans la période active. Le curseur rattrape ensuite chaque mois manqué.
    if (!regle.dernierMois) {
        if (regle.premiere >= debutPeriode) return regle.premiere;
        let date = dateDuMois(regle.premiere,monthKey(debutPeriode));
        if (date >= debutPeriode) return date;
        return moisSuivant(regle.premiere,monthKey(date));
    }
    const date = moisSuivant(regle.premiere,regle.dernierMois);
    const prochaine = date < regle.premiere ? regle.premiere : date;
    return prochaine <= aujourdHui ? prochaine : null;
}

function moisSuivant(premiere, mois) {
    const suivant = new Date(mois+'-01T12:00:00Z');
    suivant.setUTCMonth(suivant.getUTCMonth()+1);
    return dateDuMois(premiere,suivant.toISOString().slice(0,7));
}

export function prevision(regles, operations, liens, {debut, finExclusive}, aujourdHui = new Date().toLocaleDateString('sv-SE')) {
    const dates = [];
    const utilises = new Set(Object.values(liens));
    const depenses = operations.filter(op => op.X !== 'x' && centimes(op.Dépenses) > 0);
    const parEcheance = new Map(operations.filter(op=>op.echeanceId).map(op=>[op.echeanceId,op]));
    const parId = new Map(depenses.map(op => [op.id, op]));
    const index = new Map();
    const cle = (date, nom, cents) => JSON.stringify([date,trimName(nom),cents]);
    const reglesParCle = new Map();
    for (const op of depenses) {
        if (op.echeanceId || utilises.has(op.id)) continue;
        const key = cle(op.Date,op.Tiers,centimes(op.Dépenses));
        if (!index.has(key)) index.set(key,[]);
        index.get(key).push(op);
    }
    const mois = new Date(debut.slice(0,7)+'-01T12:00:00Z');
    while (mois.toISOString().slice(0,10) < finExclusive) {
        const prefix = mois.toISOString().slice(0,7);
        mois.setUTCMonth(mois.getUTCMonth()+1);
        const dernierJour = new Date(mois.getTime()-86400000).getUTCDate();
        for (const regle of regles) {
            const jour = Math.min(Number(regle.premiere.slice(8)),dernierJour);
            const date = prefix+'-'+String(jour).padStart(2,'0');
            if (date < debut || date < regle.premiere || date >= finExclusive) continue;
            const id = regle.id+':'+monthKey(date);
            const key = cle(date,regle.nom,regle.cents);
            const operation = parEcheance.get(id) || parId.get(liens[id]);
            const saisie = Boolean(regle.dernierMois && prefix <= regle.dernierMois);
            dates.push({id,regle,date,key,operation,saisie,manuel:Boolean(liens[id])});
            if (!operation && !saisie) reglesParCle.set(key,(reglesParCle.get(key) || 0)+1);
        }
    }
    let restant = 0;
    for (const ligne of dates) {
        const candidats = index.get(ligne.key);
        if (!ligne.operation && !ligne.saisie && candidats?.length === 1 && reglesParCle.get(ligne.key) === 1) {
            ligne.operation = candidats[0];
        }
        if (!ligne.operation && !ligne.saisie) restant += ligne.regle.cents;
    }
    const aPrevoir = restant;
    for (const op of operations) {
        if (op.echeanceId && op.X !== 'x' && op.Date > aujourdHui && op.Date < finExclusive) restant += centimes(op.Dépenses);
    }
    const solde = operations.filter(op=>!op.echeanceId || op.Date < finExclusive).reduce((s,op)=>op.X === 'x' ? s : s+centimes(op.Recettes)-centimes(op.Dépenses),0);
    return {dates:dates.sort((a,b)=>a.date.localeCompare(b.date)||a.regle.nom.localeCompare(b.regle.nom,'fr')),restant,projete:solde-aPrevoir};
}

export function modifierLien(liens = {}, {echeance, operation, precedent}) {
    if ((liens[echeance] ?? null) !== precedent) throw Error('Ce rapprochement a changé. Vérifie l’échéance.');
    const resultat = {...liens};
    delete resultat[echeance];
    if (operation) {
        if (Object.values(resultat).includes(operation)) throw Error('Cette dépense est déjà associée à une échéance.');
        resultat[echeance] = operation;
    }
    return resultat;
}
