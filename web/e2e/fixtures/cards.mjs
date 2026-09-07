// Cartes synthétiques du catalogue jetable (étape 6B, versionnées à l'étape 7).
// Noms ASCII, image SVG inline en `data:` : aucune requête réseau, captures
// déterministes. Les passcodes 9000xxxx n'existent pas dans le catalogue réel.
export const CARDS = [
  [90000001, 'Starter Alpha', 'Effect Monster', '#2f855a'],
  [90000002, 'Starter Beta', 'Effect Monster', '#276749'],
  [90000003, 'Combo Gamma', 'Effect Monster', '#2b6cb0'],
  [90000004, 'Combo Delta', 'Effect Monster', '#2c5282'],
  [90000005, 'Handtrap Epsilon', 'Effect Monster', '#805ad5'],
  [90000006, 'Handtrap Zeta', 'Effect Monster', '#6b46c1'],
  [90000007, 'Mulcharmy Eta', 'Effect Monster', '#b7791f'],
  [90000008, 'Mulcharmy Theta', 'Effect Monster', '#975a16'],
  [90000009, 'Quick-Play Iota', 'Spell Card', '#0987a0'],
  [90000010, 'Breaker Kappa', 'Spell Card', '#c53030'],
  [90000011, 'Filler Lambda', 'Normal Monster', '#4a5568'],
  [90000012, 'Filler Mu', 'Normal Monster', '#4a5568'],
  [90000013, 'Filler Nu', 'Normal Monster', '#4a5568'],
  [90000014, 'Target Xi', 'Effect Monster', '#d69e2e'],
  [90000015, 'Filler Omicron', 'Normal Monster', '#4a5568'],
  [90000016, 'Extra Pi', 'Fusion Monster', '#553c9a'],
  [90000017, 'Side Rho', 'Trap Card', '#9b2c2c'],
];

const svg = (name, color) => {
  const [first, ...rest] = name.split(' ');
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="118" height="172"><rect width="118" height="172" rx="6" fill="${color}"/><rect x="10" y="14" width="98" height="80" rx="3" fill="rgba(0,0,0,.35)"/><text x="59" y="125" font-family="sans-serif" font-size="11" font-weight="700" fill="%23fff" text-anchor="middle">${first}</text><text x="59" y="141" font-family="sans-serif" font-size="11" fill="%23fff" text-anchor="middle">${rest.join(' ')}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(s);
};

/** SQL d'insertion (idempotent) des cartes et de l'estampille de catalogue. */
export function cardsSql() {
  const rows = CARDS.map(([id, name, type, color]) => {
    const u = svg(name, color);
    return `(${id}, '${name}', '${type}', 'Synthetic', null, 'Carte synthetique de validation visuelle.', '${u}', '${u}', '${u}')`;
  });
  return [
    'insert into cards (id, name, type, race, attribute, description, image_url, image_url_small, image_url_cropped) values',
    rows.join(',\n'),
    'on conflict (id) do nothing;',
    `insert into catalog_version (version, copied_cards_count, local_cards_count) values ('synthetic-e2e', ${CARDS.length}, ${CARDS.length}) on conflict (only_row) do nothing;`,
    '',
  ].join('\n');
}
