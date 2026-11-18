const comparerNoms = new Intl.Collator('fr', {sensitivity:'base', numeric:true}).compare;

export function cleFournisseur(nom) {
    return nom.trim().replace(/\s+/g,' ').normalize('NFC').toLocaleLowerCase('fr');
}

export function fournisseursFrequents(operations, dateSaisie) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateSaisie)) return [];
    const mois = dateSaisie.slice(0,7);
    const compteurs = new Map();
    for (const op of operations) {
        const montant = Number(String(op['Dépenses'] ?? '').replace(/\s/g,'').replace(',','.'));
        if (op.X === 'x' || !(montant > 0) || typeof op.Tiers !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(op.Date)) continue;
        const moisOperation = op.Date.slice(0,7);
        const cle = cleFournisseur(op.Tiers);
        if (!cle || moisOperation > mois) continue;
        const fiche = compteurs.get(cle) || {nom:'', ceMois:0, historique:0, derniere:''};
        if (moisOperation === mois) fiche.ceMois++;
        else fiche.historique++;
        if (op.Date >= fiche.derniere) {
            fiche.derniere = op.Date;
            fiche.nom = op.Tiers.trim().replace(/\s+/g,' ');
        }
        compteurs.set(cle,fiche);
    }
    const classement = [...compteurs.values()].sort((a,b) =>
        b.ceMois-a.ceMois || (!a.ceMois && b.historique-a.historique) ||
        b.derniere.localeCompare(a.derniere) || comparerNoms(a.nom,b.nom)
    );
    return classement.slice(0,5).map(f=>f.nom);
}
