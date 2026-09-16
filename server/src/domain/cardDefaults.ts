/**
 * Annotations par défaut déduites du TEXTE d'une carte (docs/annotations-par-defaut.md, D1–D3′,
 * D15). Contrat pur partagé avec le web : aucune dépendance Node / Fastify / pg, aucune liste
 * de cartes (R2) — tout vient du nom, du type et de la description anglaise du catalogue.
 *
 * Deux détections indépendantes :
 *   - HOPT (R3) : la carte énonce sur ELLE-MÊME une limite par nom (« You can only use this
 *     effect of "Nom" once per turn », « You can only activate 1 "Nom" per turn », « You can only
 *     use 1 "Nom" per turn », « you cannot activate "Nom" … this turn », « once per Duel »).
 *     Un « once per turn » sans nom limite l'exemplaire, pas le nom : pas HOPT. « twice / thrice
 *     per turn » : pas HOPT. Une invocation spéciale limitée par nom (`summonOnce`) est reportée
 *     mais n'est PAS un HOPT (Q2 : le rôle statistique de la carte est ailleurs, cf. Black Chaos).
 *   - Non-engine (D3′) : quatre gabarits précis seulement, chacun donnant un PROFIL (jamais une
 *     étiquette, Q4) — Mulcharmy (précoce + plafond « Mulcharmy »), handtrap générique de
 *     monstre (réactive si la clause de déclenchement nomme l'adversaire, flexible sinon), piège
 *     activable depuis la main sans condition d'archétype (flexible), retrait de masse sans
 *     archétype (board breaker). Jamais « préparée » (Q6).
 *
 * Ce fichier entre dans `__ENGINE_VERSION__` (vite.config.ts) : toute modification d'une règle
 * périme les aperçus et les chiffres de plans (D8).
 */
import type { Availability } from './deckConfiguration.js';

/** Profils que la détection peut proposer : ceux du contrat (dont « réactive », partie B). */
export type DefaultAvailability = Availability;

/** Ce que la détection lit d'une carte du catalogue. */
export interface CardText {
  name: string;
  type?: string | null;
  race?: string | null;
  description?: string | null;
}

export type HoptKind = 'byName' | 'summonOnce' | 'byName2' | 'soft' | 'none' | 'excluded';
export interface HoptDetection {
  kind: HoptKind;
  /** Phrase-preuve (tronquée) pour l'inventaire et l'interface du référent. */
  evidence: string | null;
}

export type NonEngineTemplate = 'mulcharmy' | 'monster-handtrap' | 'trap-from-hand' | 'mass-removal';
export interface NonEngineDetection {
  availability: DefaultAvailability;
  /** Nom du plafond fourni de base (D7′), `null` sans plafond. */
  group: string | null;
  template: NonEngineTemplate;
  evidence: string;
}

/** Valeur par défaut plate d'une carte : ce que la couche « détection » propose. */
export interface CardDefaults {
  isHopt: boolean;
  availability: DefaultAvailability | null;
  group: string | null;
}

export const MULCHARMY_GROUP = 'Mulcharmy';
export const MULCHARMY_CAP = 2;

// ─── Types et normalisation ───

/** Extra deck, jetons, cartes de compétence : jamais annotés (le moteur ne lit que le main). */
const EXCLUDED_TYPE = /^(?:Fusion|Synchro|XYZ|Link|Synchro Tuner|Synchro Pendulum|XYZ Pendulum|Fusion Pendulum|Pendulum Effect Fusion) Monster$|^Token$|^Skill Card$/i;
export const isMainDeckType = (type: string | null | undefined): boolean => !EXCLUDED_TYPE.test((type ?? '').trim());

const isMonsterType = (type: string | null | undefined): boolean => /Monster$/i.test((type ?? '').trim()) && isMainDeckType(type);

const space = (s: string): string => s.replace(/\s+/g, ' ').trim();
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Nom comparable : minuscules, balises `<…>` du catalogue retirées (« Maliss <C> MTP-07 »),
 * ponctuation ramenée à des espaces (« Spell-Shattering » = « Spell Shattering »), pluriel
 * « (s) » retiré.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/<[^>]*>/g, ' ').replace(/\(s\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Découpage en phrases ; les puces « ● » ouvrent une phrase. */
function sentences(text: string): string[] {
  return space(text).split(/(?<=[.!?])\s+|(?=●)/).map((s) => s.trim()).filter(Boolean);
}

const clip = (s: string): string => (s.length > 160 ? s.slice(0, 157) + '…' : s);

// ─── HOPT ───

const OPT_ANY = /once per turn|per turn/i;

/** Le nom de la carte figure-t-il, entre guillemets, dans la phrase (littéral ou normalisé) ? */
function namesItself(sentence: string, name: string): boolean {
  const literal = new RegExp(`"${escapeRegExp(name)}(?:\\(s\\))?"`);
  if (literal.test(sentence)) return true;
  // Repli : un segment ENTRE GUILLEMETS de la fenêtre égale le nom normalisé (graphies « <C> »,
  // traits d'union, pluriel). Égalité, jamais inclusion : « Dark Magician » ne se reconnaît pas dans
  // « "Dark Magician Girl" » ; et jamais hors guillemets (relecture A, remarque 2).
  const n = normalizeName(name);
  if (n.length < 3) return false;
  const first = sentence.indexOf('"');
  const last = sentence.lastIndexOf('"');
  const candidates: string[] = [];
  if (first >= 0 && last > first) candidates.push(sentence.slice(first + 1, last)); // nom à guillemets imbriqués
  for (const m of sentence.matchAll(/"([^"]+)"/g)) candidates.push(m[1]);
  return candidates.some((c) => normalizeName(c) === n);
}

/**
 * Fenêtres de limite : de « You can only … » (ou « cannot activate ») jusqu'à la borne temporelle la
 * plus proche. On ne découpe PAS en phrases : les noms contenant un point (« D.D. Crow », « U.A. »)
 * seraient coupés. Une fenêtre s'arrête au premier « ; » ou « ● » rencontré.
 */
const LIMIT_WINDOW = /You can only (?:use|activate)[^;●]{0,200}?(?:once per turn|per Duel|once per Chain|once that turn|per turn)/gi;
const TWICE_WINDOW = /You can (?:only )?use[^;●]{0,200}?(?:twice|thrice|up to \d+ times) per turn/gi;
const TWICE_TAIL = /(?:twice|thrice|up to \d+ times) per turn$/i;
const SUMMON_WINDOW = /You can only Special Summon "[^;●]{0,200}?once per turn/gi;
const CANNOT_WINDOW = /(?:this turn|per turn)[^;●.]{0,80}?cannot activate (?:another |other )?"[^;●]{0,120}?"|cannot activate (?:another |other )?"[^;●]{0,120}?"[^;●]{0,80}?(?:this turn|per turn)/gi;

function windowsOf(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

export function detectHopt(card: CardText): HoptDetection {
  if (!isMainDeckType(card.type)) return { kind: 'excluded', evidence: null };
  const text = space(card.description ?? '');
  const name = card.name;
  const own = (w: string): boolean => namesItself(w, name);
  // Une fenêtre qui se termine par « twice / thrice per turn » n'est pas une limite à 1.
  const byName = windowsOf(text, LIMIT_WINDOW).filter((w) => !TWICE_TAIL.test(w)).find(own) ?? windowsOf(text, CANNOT_WINDOW).find(own);
  if (byName) return { kind: 'byName', evidence: clip(byName) };
  // « You can (only) use … of "Nom" twice / thrice / up to N times per turn » : limite par nom, mais pas 1.
  const twice = windowsOf(text, TWICE_WINDOW).find(own);
  if (twice) return { kind: 'byName2', evidence: clip(twice) };
  // « You can only Special Summon "Nom" once per turn (this way) » : invocation limitée, pas HOPT (Q2).
  const summon = windowsOf(text, SUMMON_WINDOW).find(own);
  if (summon) return { kind: 'summonOnce', evidence: clip(summon) };
  if (OPT_ANY.test(text)) {
    const s = sentences(text).find((x) => OPT_ANY.test(x));
    return { kind: 'soft', evidence: s ? clip(s) : null };
  }
  return { kind: 'none', evidence: null };
}

// ─── Non-engine ───

const MULCHARMY = /If you control no cards \(Quick Effect\): You can discard this card; apply these effects this turn/i;
/** Fenêtre rapide dans la phrase. */
const QUICK_WINDOW = /\(Quick Effect\)|During (?:your opponent's|either player's) (?:turn|Main Phase|Battle Phase)|During the Main Phase|When your opponent activates|If your opponent/i;
/** Action depuis la main, sur cette carte. */
const FROM_HAND = /(?:discard this card|send this card(?: and [^;]{0,40})? from your hand|Tribute this card from your hand|Special Summon (?:both )?this card from your hand|reveal this card|banish this card from your hand)/i;
/** Condition d'archétype ou de plateau propre : carte d'engine, pas de défaut. */
const ARCHETYPE_CONDITION = /"[^"]+"|you control|your (?:other )?[A-Z][\w-]* monster|Fusion Material|Synchro Material|Xyz Material|this card's Level|\bATK\b/;
/** L'adversaire est l'acteur de la clause de déclenchement → réactive (tour adverse seul). */
const OPPONENT_ACTOR = /your opponent(?:'s)?|opponent's/i;
const MASS_REMOVAL = /(?:Destroy|Negate the effects of|Banish|Return|Shuffle|Send|Tribute)[^.;]{0,30}\b(?:all|as many)\b[^.;]{0,60}(?:your opponent(?: currently)? controls|on the field|your opponent's)/i;

export function detectNonEngine(card: CardText): NonEngineDetection | null {
  if (!isMainDeckType(card.type)) return null;
  const text = card.description ?? '';
  const type = (card.type ?? '').trim();
  if (MULCHARMY.test(text)) {
    return { availability: 'early', group: MULCHARMY_GROUP, template: 'mulcharmy', evidence: clip(space(text.match(MULCHARMY)![0])) };
  }
  if (isMonsterType(type)) {
    const hit = sentences(text).find((s) => QUICK_WINDOW.test(s) && FROM_HAND.test(s));
    if (!hit) return null;
    const own = new RegExp(`"${escapeRegExp(card.name)}"`, 'g');
    // Les jetons nommés dans l'effet (« Primal Being Token ») et les parenthèses (caractéristiques du
    // jeton, précisions) ne sont pas une condition d'archétype.
    const clause = hit.replace(/\(Quick Effect\)/, '').replace(own, '').replace(/"[^"]* Token"/g, '').replace(/\([^)]*\)/g, '');
    if (ARCHETYPE_CONDITION.test(clause)) return null;
    const trigger = hit.split(':')[0] ?? '';
    return { availability: OPPONENT_ACTOR.test(trigger) ? 'reactive' : 'flexible', group: null, template: 'monster-handtrap', evidence: clip(hit) };
  }
  if (/^Trap Card$/i.test(type)) {
    // Condition éventuelle avant la virgule (« If you control no cards, you can activate… ») ; une
    // condition citant un archétype (« If you control a "X" monster ») fait de la carte une carte d'engine.
    const m = /(?:([^.]*), )?you can activate this card from your hand/i.exec(text);
    if (!m) return null;
    if (m[1] && /"[^"]+"/.test(m[1])) return null;
    return { availability: 'flexible', group: null, template: 'trap-from-hand', evidence: clip(space(m[0])) };
  }
  if (/^Spell Card$/i.test(type)) {
    const hit = sentences(text).find((s) => MASS_REMOVAL.test(s));
    if (!hit || /"[^"]+"/.test(hit)) return null;
    return { availability: 'breaker', group: null, template: 'mass-removal', evidence: clip(hit) };
  }
  return null;
}

/** Valeur par défaut plate : HOPT = classe `byName` seulement (D15). */
export function cardDefaults(card: CardText): CardDefaults {
  const hopt = detectHopt(card);
  const ne = detectNonEngine(card);
  return { isHopt: hopt.kind === 'byName', availability: ne?.availability ?? null, group: ne?.group ?? null };
}
