import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardDefaults, deckZoneOfType, detectHopt, detectNonEngine, isMainDeckType, normalizeName, MULCHARMY_CAP, MULCHARMY_GROUP, type CardText, type HoptKind } from '../src/domain/cardDefaults.js';

// Annotations par défaut, partie A (docs/annotations-par-defaut.md §2.3–2.5, D2, D3′, D15).
// Les textes sont ceux du catalogue réel (fixtures/card-texts.json : 84 cartes choisies ;
// fixtures/card-texts-played.json : les 126 cartes de main de l'archive de production du
// 8 septembre 2026 présentes au catalogue ; fixtures/played-choices.json : nombre de decks,
// copies maximales, choix HOPT et étiquettes du compte expert, sans donnée de compte).
const fixture = (name: string): CardText[] => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as CardText[];
const TEXTS = fixture('card-texts.json');
const byName = new Map(TEXTS.map((c) => [c.name, c]));
const card = (name: string): CardText => { const c = byName.get(name); if (!c) throw new Error(`fixture sans « ${name} »`); return c; };

test('types : extra deck, jetons et cartes de compétence ne sont jamais annotés', () => {
  // Plans de side v2 (Q7) : les 29 types du catalogue du 17 septembre 2026 — « Synchro Pendulum Effect Monster »
  // (8 cartes) et « XYZ Pendulum Effect Monster » (10 cartes) sont d'Extra Deck.
  const EXTRA = ['Fusion Monster', 'Synchro Monster', 'XYZ Monster', 'Link Monster', 'Synchro Tuner Monster', 'Pendulum Effect Fusion Monster', 'Synchro Pendulum Effect Monster', 'XYZ Pendulum Effect Monster'];
  const MAIN = ['Effect Monster', 'Flip Effect Monster', 'Flip Tuner Effect Monster', 'Gemini Monster', 'Normal Monster', 'Normal Tuner Monster', 'Pendulum Effect Monster', 'Pendulum Effect Ritual Monster', 'Pendulum Flip Effect Monster', 'Pendulum Normal Monster', 'Pendulum Tuner Effect Monster', 'Ritual Effect Monster', 'Ritual Monster', 'Spell Card', 'Spirit Monster', 'Toon Monster', 'Trap Card', 'Tuner Monster', 'Union Effect Monster'];
  for (const t of [...EXTRA, 'Token', 'Skill Card']) assert.equal(isMainDeckType(t), false, t);
  for (const t of [...MAIN, null, undefined]) assert.equal(isMainDeckType(t), true, String(t));
  assert.equal(EXTRA.length + MAIN.length + 2, 29, 'les 29 types du catalogue');
  // La zone d'une carte n'est jamais devinée : type absent, jeton ou compétence → null.
  for (const t of EXTRA) assert.equal(deckZoneOfType(t), 'extra', t);
  for (const t of MAIN) assert.equal(deckZoneOfType(t), 'main', t);
  for (const t of ['Token', 'Skill Card', '', '  ', null, undefined]) assert.equal(deckZoneOfType(t), null, String(t));
  assert.equal(detectHopt({ name: 'Odd-Eyes Rebellion Dragon', type: 'XYZ Pendulum Effect Monster', description: 'You can only use this effect of "Odd-Eyes Rebellion Dragon" once per turn.' }).kind, 'excluded');
  assert.equal(detectHopt(card('Sky Striker Ace - Kagari')).kind, 'excluded');
  assert.equal(detectHopt(card('Mirrorjade the Iceblade Dragon')).kind, 'excluded');
  assert.equal(detectNonEngine(card('Mirrorjade the Iceblade Dragon')), null);
});

test('normalisation de nom : balises, ponctuation, pluriel', () => {
  assert.equal(normalizeName('Maliss <C> MTP-07'), 'maliss mtp 07');
  assert.equal(normalizeName('Spell-Shattering Sword'), 'spell shattering sword');
  assert.equal(normalizeName('Servant(s) of Endymion'), 'servant of endymion');
  assert.equal(normalizeName('Maxx "C"'), 'maxx c');
});

const HOPT: Record<string, HoptKind> = {
  // limite par nom propre : formulations « this effect », « each effect », « 1 "X" per turn », « activate 1 "X" », per Duel
  'Ash Blossom & Joyous Spring': 'byName', 'Nibiru, the Primal Being': 'byName', 'Ghost Ogre & Snow Rabbit': 'byName',
  'Ghost Belle & Haunted Mansion': 'byName', 'Maxx "C"': 'byName', 'Infinite Impermanence': 'none', 'Dominus Impulse': 'byName',
  'Triple Tactics Talent': 'byName', 'Lightning Storm': 'byName', 'Pot of Prosperity': 'byName', 'Pot of Desires': 'byName',
  'Forbidden Droplet': 'byName', 'Crossout Designator': 'byName', 'Fiendsmith Engraver': 'byName', 'Snake-Eye Ash': 'byName',
  'Kashtira Fenrir': 'byName', 'Speedroid Terrortop': 'byName', 'Mitsurugi no Mikoto, Saji': 'byName', 'Ragged Records of Rites': 'byName',
  'Light and Darkness Ritual': 'byName', 'Bystial Magnamhut': 'byName', 'Kurikara Divincarnate': 'byName',
  'Black Luster Soldier - Soldier of Light and Darkness': 'byName', 'Elfnote Regina': 'byName', 'Elfnotes: Welcome Home': 'byName',
  'Underworld Circle': 'byName', // « per Duel »
  'Pot of Sloth': 'byName', // « you cannot activate "Pot of Sloth" » pour le reste du tour
  // guillemets imbriqués et graphies du catalogue
  'World Legacy - "World Crown"': 'byName', 'Therion "King" Regulus': 'byName', 'Sneaky "C"': 'byName',
  'Maliss <C> MTP-07': 'byName', 'Maliss <P> White Rabbit': 'byName', 'Spell Shattering Sword': 'byName',
  'Servant of Endymion': 'summonOnce',
  'Migratory Zereort': 'soft', // renommée au catalogue (« Zereort Migrator ») : hors de portée du texte, référence
  // invocation limitée par nom : reportée, pas HOPT (Q2)
  'Black Chaos': 'summonOnce',
  // limite par exemplaire, ou aucune
  'Effect Veiler': 'none', 'Droll & Lock Bird': 'none', 'D.D. Crow': 'none', 'Dimension Shifter': 'none', 'Called by the Grave': 'none',
  'Super Polymerization': 'none', 'Foolish Burial': 'none', 'Dark Magician': 'none', 'Cyber Dragon': 'none', 'Book of Moon': 'none',
  'Raigeki': 'none', 'Dark Hole': 'none', 'Solemn Strike': 'none', 'Evenly Matched': 'none', 'Manju of the Ten Thousand Hands': 'none',
  'Scrap Recycler': 'soft', 'Coach Goblin': 'soft', 'Mulcharmy Fuwalos': 'none', 'Mulcharmy Purulia': 'none',
};

test('HOPT : classes attendues sur des textes réels', () => {
  for (const [name, kind] of Object.entries(HOPT)) {
    const got = detectHopt(card(name));
    assert.equal(got.kind, kind, `${name} : ${got.kind} (${got.evidence ?? '—'})`);
    if (kind === 'byName' || kind === 'summonOnce' || kind === 'byName2') assert.ok(got.evidence && got.evidence.length > 10, `${name} : preuve`);
  }
  // Seule la classe byName vaut HOPT par défaut (D15).
  assert.equal(cardDefaults(card('Ash Blossom & Joyous Spring')).isHopt, true);
  assert.equal(cardDefaults(card('Black Chaos')).isHopt, false);
  assert.equal(cardDefaults(card('Effect Veiler')).isHopt, false);
});

test('HOPT : « twice / thrice per turn » par nom est reporté byName2, jamais HOPT', () => {
  const twice = TEXTS.filter((c) => /(?:twice|thrice) per turn/i.test(c.description ?? '') && isMainDeckType(c.type));
  assert.ok(twice.length >= 2, 'fixture : au moins deux cartes « twice / thrice »');
  for (const c of twice) {
    assert.equal(detectHopt(c).kind, 'byName2', c.name);
    assert.equal(cardDefaults(c).isHopt, false, c.name);
  }
});

test('HOPT : une carte qui cite un AUTRE nom ne se limite pas elle-même ; une limite sans nom reste soft', () => {
  const other: CardText = { name: 'Copycat', type: 'Effect Monster', description: 'You can only use this effect of "Ash Blossom & Joyous Spring" once per turn.' };
  assert.equal(detectHopt(other).kind, 'soft');
  // Relecture A : un nom préfixe d'un autre nom cité, ou présent hors guillemets, ne se limite pas lui-même.
  const prefix: CardText = { name: 'Dark Magician', type: 'Normal Monster', description: 'You can only activate 1 "Dark Magician Girl" effect per turn.' };
  assert.equal(detectHopt(prefix).kind, 'soft');
  const unquoted: CardText = { name: 'Bob', type: 'Effect Monster', description: "You can only use this effect once while Bob is on the field. During your opponent's turn, you can add 1 card per turn." };
  assert.equal(detectHopt(unquoted).kind, 'soft');
  const soft: CardText = { name: 'Soft', type: 'Effect Monster', description: 'Once per turn: You can draw 1 card. You can only use this effect once per turn.' };
  assert.equal(detectHopt(soft).kind, 'soft');
  const none: CardText = { name: 'Vanilla', type: 'Normal Monster', description: 'A dragon.' };
  assert.equal(detectHopt(none).kind, 'none');
  assert.equal(detectHopt({ name: 'Empty', type: 'Spell Card', description: null }).kind, 'none');
});

test('non-engine : gabarits précis, profil seulement, jamais « préparée »', () => {
  const ne = (name: string) => detectNonEngine(card(name));
  for (const n of ['Mulcharmy Fuwalos', 'Mulcharmy Purulia', 'Mulcharmy Meowls']) {
    assert.deepEqual({ availability: ne(n)?.availability, group: ne(n)?.group, template: ne(n)?.template }, { availability: 'early', group: MULCHARMY_GROUP, template: 'mulcharmy' }, n);
  }
  assert.equal(MULCHARMY_CAP, 2);
  // handtrap générique : réactive quand la clause de déclenchement nomme l'adversaire, flexible sinon
  for (const n of ['Effect Veiler', 'Nibiru, the Primal Being', 'Droll & Lock Bird', 'Skull Meister', 'Retaliating "C"', 'Kuriboh', 'Herald of Orange Light', 'Artifact Lancea']) assert.equal(ne(n)?.availability, 'reactive', n);
  for (const n of ['Ash Blossom & Joyous Spring', 'Ghost Ogre & Snow Rabbit', 'Ghost Belle & Haunted Mansion', 'D.D. Crow', 'Dimension Shifter', 'Maxx "C"', 'Hanewata']) assert.equal(ne(n)?.availability, 'flexible', n);
  for (const n of ['Effect Veiler', 'Ash Blossom & Joyous Spring']) assert.equal(ne(n)?.template, 'monster-handtrap', n);
  // pièges activables depuis la main sans condition d'archétype
  for (const n of ['Infinite Impermanence', 'Dominus Impulse', 'Dominus Purge', 'Red Reboot', 'Evenly Matched']) assert.deepEqual([ne(n)?.availability, ne(n)?.template], ['flexible', 'trap-from-hand'], n);
  assert.equal(ne('Lord of the Tachyon Galaxy'), null, 'piège depuis la main conditionné à un archétype');
  // retraits de masse sans archétype
  for (const n of ['Raigeki', 'Lightning Storm', 'Dark Hole', "Harpie's Feather Duster", 'Dark Ruler No More']) assert.deepEqual([ne(n)?.availability, ne(n)?.template], ['breaker', 'mass-removal'], n);
  assert.equal(ne('Earthbound Whirlwind'), null, 'retrait de masse conditionné à un archétype');
  // aucun défaut : magies rapides et pièges ordinaires (jamais « préparée »), cartes d'engine à effet rapide depuis la main, boss, vanilles
  for (const n of ['Called by the Grave', 'Crossout Designator', 'Forbidden Droplet', 'Book of Moon', 'Cosmic Cyclone', 'Solemn Strike', 'Triple Tactics Talent', 'Super Polymerization',
    'Arias the Labrynth Butler', 'Traptrix Arachnocampa', 'Fiendsmith Engraver', 'Snake-Eye Ash', 'Kashtira Fenrir', 'Cyber Dragon', 'Dark Magician',
    'Black Luster Soldier - Soldier of Light and Darkness', 'Pot of Prosperity', 'Foolish Burial']) assert.equal(ne(n), null, n);
  // manqués connus (§2.4), à la charge du référent : le texte ne suffit pas
  for (const n of ['Kurikara Divincarnate', 'Bystial Magnamhut', 'PSY-Framegear Gamma']) assert.equal(ne(n), null, `${n} : manqué assumé`);
  // Faux positifs assumés (§2.4 : formulation générique sur une carte d'engine), correction au référent :
  // Griffoh (défausse générique, engine rituel), The Iris Swordsoul (invocation rapide sans condition d'archétype).
  assert.equal(ne('Griffoh')?.availability, 'flexible');
  assert.equal(ne('The Iris Swordsoul')?.availability, 'flexible');
});

test('cartes jouées (archive prod du 8 sept. 2026) : accord avec les choix HOPT du compte expert', () => {
  const played = fixture('card-texts-played.json');
  const choices = JSON.parse(readFileSync(new URL('./fixtures/played-choices.json', import.meta.url), 'utf8')) as Array<{ id: number; name: string; decks: number; maxCopies: number; hoptChoice: boolean | null; labels: string[] }>;
  const text = new Map(played.map((c) => [(c as CardText & { id: number }).id, c]));
  assert.equal(played.length, 126);
  const rows = choices.filter((c) => text.has(c.id)).map((c) => ({ ...c, kind: detectHopt(text.get(c.id)!).kind, hopt: cardDefaults(text.get(c.id)!).isHopt }));
  assert.equal(rows.length, 126);
  const trues = rows.filter((r) => r.hoptChoice === true);
  const falses = rows.filter((r) => r.hoptChoice === false);
  const unset = rows.filter((r) => r.hoptChoice === null);
  assert.equal(trues.length, 99); assert.equal(falses.length, 8); assert.equal(unset.length, 19);
  // 97 des 99 HOPT du compte sont retrouvés ; manqués : Droll & Lock Bird (aucune limite écrite) et Abominable
  // Unchained Soul (invocation limitée par nom, classe summonOnce : pas HOPT par détection, Q2 — au référent).
  assert.deepEqual(trues.filter((r) => !r.hopt).map((r) => r.name).sort(), ['Abominable Unchained Soul', 'Droll & Lock Bird']);
  assert.equal(rows.find((r) => r.name === 'Abominable Unchained Soul')?.kind, 'summonOnce');
  // Parmi les 8 « pas HOPT » du compte, trois étaient des erreurs de saisie corrigées par la détection ;
  // Black Chaos (invocation limitée) reste non HOPT (Q2).
  assert.deepEqual(falses.filter((r) => r.hopt).map((r) => r.name).sort(), ['Black Luster Soldier - Soldier of Light and Darkness', 'Elfnote Regina', 'Elfnotes: Welcome Home']);
  assert.equal(rows.find((r) => r.name === 'Black Chaos')?.kind, 'summonOnce');
  // Couverture : 11 cartes sans choix reçoivent un HOPT ; aucune carte d'extra deck parmi les jouées.
  assert.equal(unset.filter((r) => r.hopt).length, 11);
  assert.equal(rows.filter((r) => r.kind === 'excluded').length, 0);
  // Non-engine : toutes les cartes étiquetées « Handtrap » par le compte reçoivent un profil réactif ou flexible ;
  // les cartes détectées non-engine parmi les jouées sont exactement celles attendues.
  const ne = rows.map((r) => ({ name: r.name, labels: r.labels, d: detectNonEngine(text.get(r.id)!) }));
  for (const r of ne.filter((x) => x.labels.includes('Handtrap'))) assert.ok(r.d && (r.d.availability === 'reactive' || r.d.availability === 'flexible'), `${r.name} : ${JSON.stringify(r.d)}`);
  assert.deepEqual(ne.filter((x) => x.d).map((x) => `${x.name}:${x.d!.availability}`).sort(), [
    'Ash Blossom & Joyous Spring:flexible', 'Dimension Shifter:flexible', 'Dominus Impulse:flexible', 'Dominus Spark:flexible', 'Droll & Lock Bird:reactive',
    'Effect Veiler:reactive', 'Fydraulis Harmonia:reactive', 'Ghost Belle & Haunted Mansion:flexible', 'Ghost Ogre & Snow Rabbit:flexible', 'Griffoh:flexible',
    'Infinite Impermanence:flexible', 'K9-17 Izuna:reactive', 'K9-ØØ Lupis:reactive', 'Mulcharmy Fuwalos:early', 'Mulcharmy Purulia:early',
  ]);
});
