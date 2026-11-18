const monthKey = date => date.slice(0,7);
const trimName = text => String(text ?? '').trim().replace(/\s+/g,' ').toLocaleLowerCase('fr');
const centimes = value => Math.round(Number(String(value || 0).replace(/\s/g,'').replace(',','.')) * 100) || 0;

export function prevision(regles, operations, liens, {debut, finExclusive}) {
    const dates = [];
    const utilises = new Set(Object.values(liens));
    const depenses = operations.filter(op => op.X !== 'x' && centimes(op.Dépenses) > 0);
    const parId = new Map(depenses.map(op => [op.id, op]));
    const index = new Map();
    const cle = (date, nom, cents) => JSON.stringify([date,trimName(nom),cents]);
    const reglesParCle = new Map();
    for (const op of depenses) {
        if (utilises.has(op.id)) continue;
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
            const operation = parId.get(liens[id]);
            dates.push({id,regle,date,key,operation,manuel:Boolean(liens[id])});
            if (!operation) reglesParCle.set(key,(reglesParCle.get(key) || 0)+1);
        }
    }
    let restant = 0;
    for (const ligne of dates) {
        const candidats = index.get(ligne.key);
        if (!ligne.operation && candidats?.length === 1 && reglesParCle.get(ligne.key) === 1) {
            ligne.operation = candidats[0];
        }
        if (!ligne.operation) restant += ligne.regle.cents;
    }
    const solde = operations.reduce((s,op)=>op.X === 'x' ? s : s+centimes(op.Recettes)-centimes(op.Dépenses),0);
    return {dates:dates.sort((a,b)=>a.date.localeCompare(b.date)||a.regle.nom.localeCompare(b.regle.nom,'fr')),restant,projete:solde-restant};
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
