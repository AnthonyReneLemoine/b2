import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for (const file of ['index.html','iconmonstr-bank.png','essai.mjs','firebase-essai.mjs','prelevements.mjs','echeancier.mjs']) {
  await copyFile(file,'dist/'+file);
}
