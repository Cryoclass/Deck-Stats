// Mutants appliqués à la COPIE du code (scratchpad/audit05/mirror/web), jamais au dépôt.
// Chaque mutant : fichier relatif à web/, texte exact à remplacer (doit apparaître une seule fois),
// remplacement, et l'erreur plausible qu'il simule.
export const MUTANTS = [
  // ── engine/enumerate.ts ──
  { id: 'E1', file: 'src/engine/enumerate.ts', from: 'if (kF < 0 || kF > filler) return;', to: 'if (kF < 0 || kF >= filler) return;', why: 'borne du filler décalée de 1' },
  { id: 'E2', file: 'src/engine/enumerate.ts', from: 'if (plain > 0) visit(k, -1, w * plain);', to: 'if (plain > 1) visit(k, -1, w * plain);', why: 'issue « sixième neutre » perdue quand une seule copie neutre' },
  { id: 'E3', file: 'src/engine/enumerate.ts', from: 'visit(k, t, w * k[t]);', to: 'visit(k, t, w);', why: 'poids de la sixième identifiée non multiplié' },
  { id: 'E4', file: 'src/engine/enumerate.ts', from: 'c5 * Math.max(0, deckSize - 5)', to: 'c5 * Math.max(0, deckSize - 6)', why: 'dénominateur Z du second faux' },
  { id: 'E5', file: 'src/engine/enumerate.ts', from: '      ...input,\n      types: input.types.map((tt, j) => (j === i ? { ...tt, copies: tt.copies - 1 } : tt)),', to: '      ...input,\n      deckSize: input.deckSize - 1,\n      types: input.types.map((tt, j) => (j === i ? { ...tt, copies: tt.copies - 1 } : tt)),', why: 'contribution marginale : copie retirée du deck au lieu de devenir neutre' },
  { id: 'E6', file: 'src/engine/enumerate.ts', from: 'const baseFirst = first.startsBuckets.slice(1)', to: 'const baseFirst = first.startsBuckets.slice(2)', why: 'base des deltas premier = P(≥2) au lieu de P(≥1)' },
  { id: 'E7', file: 'src/engine/enumerate.ts', from: 'startsExactP.slice(3).reduce', to: 'startsExactP.slice(4).reduce', why: 'seau ≥3 départs perd la masse « exactement 3 »' },
  { id: 'E8', file: 'src/engine/enumerate.ts', from: 'const sb = Math.min(out.starts, 3);', to: 'const sb = Math.min(out.starts, 2);', why: 'matrice : ligne ≥3 fusionnée dans la ligne 2' },
  { id: 'E9', file: 'src/engine/enumerate.ts', from: 'const key = `${out.starts}|${out.redundancy}|${out.neContrib.join(\',\')}${cappedKey}`;', to: 'const key = `${out.starts}|${out.neContrib.join(\',\')}${cappedKey}`;', why: 'seaux fusionnés sans la redondance (requête « Redondance » fausse)' },
  { id: 'E10', file: 'src/engine/enumerate.ts', from: "const dead = context === 'first' ? prep.deadFirst : prep.deadSecond;\n  let w1 = 0;", to: "const dead = context === 'first' ? prep.deadSecond : prep.deadFirst;\n  let w1 = 0;", why: 'deltas : cartes mortes premier / second inversées' },
  { id: 'E11', file: 'src/engine/enumerate.ts', from: ' || !Number.isSafeInteger(outcomes)) {', to: ') {', why: 'garde de précision entière retirée' },
  // ── engine/evaluate.ts ──
  { id: 'V1', file: 'src/engine/evaluate.ts', from: 'const count = t.isHopt ? 1 : k[i];', to: 'const count = t.isHopt ? 1 : Math.min(k[i], 2);', why: 'non-HOPT : au plus 2 sommets par type' },
  { id: 'V2', file: 'src/engine/evaluate.ts', from: 'const redundancy = countEdges(vertices, typeAdj, disabled);', to: 'const redundancy = countEdges(nonStarter, typeAdj, disabled);', why: 'redondance calculée sans les starters' },
  { id: 'V3', file: 'src/engine/evaluate.ts', from: 'for (const c of input.types[i].categories) catCounts[c] += k[i];', to: 'for (const c of input.types[i].categories) catCounts[c] += 1;', why: 'copies brutes par catégorie comptées par type' },
  { id: 'V4', file: 'src/engine/evaluate.ts', from: "if (profile === 'flexible' || profile === 'prepared') {", to: "if (profile === 'flexible') {", why: 'profil « préparée » sans fenêtre en premier' },
  { id: 'V5', file: 'src/engine/evaluate.ts', from: "case 'early':\n        opp = initial;", to: "case 'early':\n        opp = initial + sixth;", why: 'précoce : la sixième compte au tour adverse initial' },
  { id: 'V6', file: 'src/engine/evaluate.ts', from: 'own = Math.min(own, 1);', to: 'own = own;', why: 'HOPT non appliqué au tour propre' },
  { id: 'V7', file: 'src/engine/evaluate.ts', from: 'return Math.min(each, unit.cap + own, unit.cap + opp, 2 * unit.cap);', to: 'return Math.min(each, unit.cap + own, 2 * unit.cap);', why: 'plafond partagé : terme cap + opp oublié' },
  { id: 'V8', file: 'src/engine/evaluate.ts', from: 'return Math.min(each, unit.cap + own, unit.cap + opp, 2 * unit.cap);', to: 'return Math.min(each, unit.cap + opp, 2 * unit.cap);', why: 'plafond partagé : terme cap + own oublié' },
  { id: 'V9', file: 'src/engine/evaluate.ts', from: 'neContrib[s] += Math.min(member[3], member[1] + member[2]);', to: 'neContrib[s] += member[1] + member[2];', why: 'une copie compte deux fois (deux fenêtres)' },
  { id: 'V10', file: 'src/engine/evaluate.ts', from: 'return copies[c.type] - (k[c.type] ?? 0) >= c.atLeast;', to: 'return copies[c.type] - (k[c.type] ?? 0) > c.atLeast;', why: 'condition « au moins n » stricte' },
  { id: 'V11', file: 'src/engine/evaluate.ts', from: 'return copies[c.type] - (k[c.type] ?? 0) >= c.atLeast;', to: 'return copies[c.type] >= c.atLeast;', why: 'condition sur le deck entier au lieu du deck restant' },
  { id: 'V12', file: 'src/engine/evaluate.ts', from: "const dead = context === 'first' ? prep.deadFirst : prep.deadSecond;\n  const copies", to: "const dead = context === 'first' ? prep.deadSecond : prep.deadFirst;\n  const copies", why: 'évaluation : cartes mortes premier / second inversées' },
  { id: 'V13', file: 'src/engine/evaluate.ts', from: 'nonEngine[i] = profile !== undefined && t.categories.length > 0;', to: 'nonEngine[i] = profile !== undefined;', why: 'profil sans étiquette compté (Q1)' },
  { id: 'V14', file: 'src/engine/evaluate.ts', from: "(profile === 'early' || profile === 'flexible')", to: "(profile === 'early')", why: 'flexible non sensible à la sixième' },
  { id: 'V15', file: 'src/engine/evaluate.ts', from: 'const c = prep.edgeConditions[e];\n        if (!c || conditionHolds(c, k, copies)) return true;', to: 'const c = prep.edgeConditions[e];\n        if (!c || true) return true;', why: 'deltas : condition de paire ignorée' },
  { id: 'V16', file: 'src/engine/evaluate.ts', from: "case 'flexible':\n        opp = initial; // seule une carte initiale peut servir au tour adverse initial\n        own = initial + sixth;", to: "case 'flexible':\n        opp = initial; // seule une carte initiale peut servir au tour adverse initial\n        own = initial;", why: 'flexible : la sixième ne sert pas au tour propre' },
  // ── engine/matching.ts ──
  { id: 'MT1', file: 'src/engine/matching.ts', from: 'opts &= opts - 1;', to: 'opts = 0;', why: 'couplage glouton (premier voisin seulement)' },
  // ── engine/query.ts ──
  { id: 'Q1', file: 'src/engine/query.ts', from: 'if (cr.min !== null && v < cr.min) return false;', to: 'if (cr.min !== null && v <= cr.min) return false;', why: 'borne min exclusive' },
  { id: 'Q2', file: 'src/engine/query.ts', from: 'sig.cats.some((c) => ids.has(c))', to: 'sig.cats.every((c) => ids.has(c))', why: 'groupe de catégories : signature partielle ignorée' },
  { id: 'Q3', file: 'src/engine/query.ts', from: "case 'redundancy':\n      return ctx.redundancy;", to: "case 'redundancy':\n      return ctx.starts;", why: 'critère « Redondance » lit les départs' },
  { id: 'Q4', file: 'src/engine/query.ts', from: 'if (ctx.neCapped) {', to: 'if (false) {', why: 'requête par catégorie ignore les unités à plafond partagé' },
  // ── engine/hand.ts ──
  { id: 'H1', file: 'src/engine/hand.ts', from: 'if (it.s < s) below += it.weight;', to: 'if (it.s <= s) below += it.weight;', why: 'note /10 : égalités comptées comme inférieures' },
  { id: 'H2', file: 'src/engine/hand.ts', from: 'const j = i + Math.floor(Math.random() * (pool.length - i));', to: 'const j = Math.floor(Math.random() * pool.length);', why: 'mélange biaisé du mur de mains (Fisher–Yates cassé)' },
  { id: 'H3', file: 'src/engine/hand.ts', from: 'typeIndexByCardId.get(cards[cards.length - 1])', to: 'typeIndexByCardId.get(cards[0])', why: 'mur de mains : mauvaise carte identifiée comme sixième' },
  { id: 'H4', file: 'src/engine/hand.ts', from: 'return starts * 100 + importance * neTotal;', to: 'return starts * 100 + neTotal;', why: 'curseur « importance non-engine » ignoré par la note' },
  // ── engine/compare.ts ──
  { id: 'C1', file: 'src/engine/compare.ts', from: 'compute: (m) => tailSum(m, 2, 2),', to: 'compute: (m) => tailSum(m, 2, 1),', why: 'agrégat « Main forte » mal borné' },
  { id: 'C2', file: 'src/engine/compare.ts', from: 'row[Math.min(j, NUM_COLS - 1)] += src[j] ?? 0;', to: 'if (j < NUM_COLS) row[j] += src[j] ?? 0;', why: 'colonne 5+ perd la masse ≥6' },
  { id: 'C3', file: 'src/engine/compare.ts', from: 'const dead = first ? t.deadFirst : t.deadSecond;', to: 'const dead = first ? t.deadSecond : t.deadFirst;', why: 'S affiché : mortes premier / second inversées' },
  // ── engine/binomial.ts ──
  { id: 'BN1', file: 'src/engine/binomial.ts', from: 'const key = `${n}:${kk}`;', to: 'const key = `${n}`;', why: 'cache binomial sans k' },
  // ── lib/engineModel.ts ──
  { id: 'B1', file: 'src/lib/engineModel.ts', from: '!s.pairExclusions.has(p.id) &&', to: '', why: 'paires désactivées encore actives dans le calcul' },
  { id: 'B2', file: 'src/lib/engineModel.ts', from: 'deadFirst: s.deadFirst.has(id),\n      deadSecond: s.deadSecond.has(id),', to: 'deadFirst: s.deadSecond.has(id),\n      deadSecond: s.deadFirst.has(id),', why: 'annotation « morte en premier / second » inversée à la construction du modèle' },
  { id: 'B3', file: 'src/lib/engineModel.ts', from: 'for (const id of requiredCardIds(r.condition)) if (mainCopies.has(id)) annotated.add(id);', to: '', why: 'cibles de conditions non suivies' },
  { id: 'B4', file: 'src/lib/engineModel.ts', from: "...(s.starters.has(id) ? { starterCondition: conditionOf(s.startConditions.find((r) => r.sourceCardId === id)) } : {}),", to: "...(s.starters.has(id) ? { starterCondition: conditionOf(s.startConditions.find((r) => r.sourceCardId !== null)) } : {}),", why: 'condition de starter prise sur la mauvaise carte (plusieurs starters conditionnels)' },
  // ── lib/conditions.ts ──
  { id: 'LC1', file: 'src/lib/conditions.ts', from: 'type: typeIndexOf(node.card_id) ?? null', to: 'type: typeIndexOf(node.card_id) ?? 0', why: 'cible absente du deck assimilée au type 0' },
  // ── lib/statsViews.ts ──
  { id: 'SV1', file: 'src/lib/statsViews.ts', from: 'buckets: toBuckets(cat.dist),', to: 'buckets: toBuckets(pass.nonEngine),', why: 'vue « étiquette » du panneau affiche le non-engine global' },
  { id: 'SV2', file: 'src/lib/statsViews.ts', from: 'return [null, b1 + b2 + b3, b2 + b3, b3];', to: 'return [null, b1 + b2 + b3, b2, b3];', why: 'cumulé « au moins 2 » faux' },
  // ── lib/summary.ts ──
  { id: 'SU1', file: 'src/lib/summary.ts', from: 'brickRate: pass.brick,', to: 'brickRate: 1 - pass.brick,', why: 'aperçu : brick inversé' },
  { id: 'SU2', file: 'src/lib/summary.ts', from: 'if (s.engineVersion !== engineVersion) return null;', to: '', why: 'aperçu d’une autre version du moteur affiché' },
  // ── store/selectors.ts ──
  { id: 'S1', file: 'src/store/selectors.ts', from: 's.result!.deltas[i] ??', to: 's.result!.deltas[i + 1] ??', why: 'delta affiché sur la tuile d’une autre carte' },
  { id: 'S2', file: 'src/store/selectors.ts', from: "const context = handSize <= 5 ? 'first' : 'second';", to: "const context = handSize <= 6 ? 'first' : 'second';", why: 'mur de mains second noté avec la passe premier' },
  // ── lib/sidePlan.ts ──
  { id: 'SP1', file: 'src/lib/sidePlan.ts', from: "issues.length > 0 ? 'review' : outgoing !== incoming ? 'incomplete' : 'ready'", to: "issues.length > 0 ? 'review' : 'ready'", why: 'plan déséquilibré analysé comme prêt' },
  { id: 'SP2', file: 'src/lib/sidePlan.ts', from: "atLeast('u', 'nonengine', position === 'first' ? 1 : 2)", to: "atLeast('u', 'nonengine', 2)", why: 'indicateur « main forte » premier mal défini' },
  { id: 'SP3', file: 'src/lib/sidePlan.ts', from: 'fnv1a64(JSON.stringify({ engineVersion, position, criteria, input }))', to: 'fnv1a64(JSON.stringify({ engineVersion, position, input }))', why: 'empreinte de plan sans les critères (chiffres périmés servis)' },
  { id: 'SP4', file: 'src/lib/sidePlan.ts', from: "if (c.copies > available) issues.push({ kind: 'incoming-missing'", to: "if (false) issues.push({ kind: 'incoming-missing'", why: 'carte entrante absente du side non signalée' },
];
