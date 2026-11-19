// Tous les montants Swile sont des centimes entiers.
export const plafondSwile = 2500;
export const jourSwile = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function centimesSwile(valeur) {
  const texte = String(valeur).trim().replace(',','.');
  if (!/^\d+(\.\d{1,2})?$/.test(texte)) throw Error('Saisis un montant en euros avec deux décimales au maximum.');
  const [euros, fraction=''] = texte.split('.');
  const centimes = Number(euros)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(centimes)) throw Error('Montant trop élevé.');
  return centimes;
}
const dateValide = date => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;

export function bilanSwile(carte, mouvements, jour) {
  let solde = carte.initial;
  let depense = carte.date === jour ? carte.utilise : 0;
  for (const m of mouvements) {
    if (m.date > jour) continue;
    solde += m.type === 'depense' ? -m.montant : m.montant;
    if (m.date === jour && m.type === 'depense') depense += m.montant;
  }
  return {solde, disponible:Math.max(0,Math.min(solde,plafondSwile-depense))};
}

export function verifierOuverture(carte,aujourdhui) {
  if (!dateValide(carte.date) || carte.date > aujourdhui) throw Error('Vérifie la date du solde de départ.');
  if (!Number.isSafeInteger(carte.initial) || carte.initial < 0 || !Number.isSafeInteger(carte.utilise) || carte.utilise < 0 || carte.utilise > plafondSwile)
    throw Error('Vérifie le solde et le montant déjà utilisé (maximum 25 €).');
}
export function verifierMouvement(carte,mouvements,m,aujourdhui) {
  if (!carte) throw Error('Renseigne d’abord ton solde de départ dans l’onglet Swile.');
  if (!dateValide(m.date) || m.date < carte.date || m.date > aujourdhui)
    throw Error('Choisis une date comprise entre le début du suivi Swile et aujourd’hui.');
  if (!Number.isSafeInteger(m.montant) || m.montant <= 0) throw Error('Le montant doit être supérieur à zéro.');
  if (m.type === 'recharge') return;
  if (m.type !== 'depense' || !m.tiers?.trim()) throw Error('Renseigne le fournisseur de la dépense.');
  const {solde,disponible} = bilanSwile(carte,mouvements,m.date);
  if (m.montant > solde) throw Error('Le solde de la carte est insuffisant à cette date.');
  if (m.montant > disponible) throw Error('Cette dépense dépasse le disponible du jour (plafond de 25 €).');
  // Une dépense antidatée doit aussi laisser le solde positif les jours suivants.
  let restant = solde - m.montant;
  const suivants = new Map();
  for (const op of mouvements) if (op.date > m.date)
    suivants.set(op.date,(suivants.get(op.date)||0) + (op.type==='depense' ? -op.montant : op.montant));
  for (const date of [...suivants.keys()].sort()) {
    restant += suivants.get(date);
    if (restant < 0) throw Error('Cette dépense rendrait le solde négatif à une date ultérieure.');
  }
}
