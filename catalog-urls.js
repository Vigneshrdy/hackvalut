// Shared URL rules: keep existing public identities, encode collection labels losslessly.
export const encode = encodeURIComponent;
export const hackathonPath = (id) => `/hackathons/${encode(id)}`;
export const editionPath = (h, e) => `${hackathonPath(h)}/${encode(e)}`;
export const problemPath = (p) => `${editionPath(p.hackathon.id, p.edition.id)}/problems/${encode(p.id)}`;
export const collectionPath = (h, e, kind, value = '') => `${editionPath(h, e)}/${kind}${value ? `/${encode(value)}` : ''}`;
export const facets = { themes: 'theme', organizations: 'organization', categories: 'category' };
export function collections(rows) {
  return Object.entries(facets).flatMap(([kind, field]) => [...new Set(rows.map(p => p[field]).filter(Boolean))].sort().map(value => ({ kind, field, value, count: rows.filter(p => p[field] === value).length })));
}
export function editionTitle(h, e) {
  return `${e.name.includes(h.name) ? e.name : `${h.name} ${e.name}`} Problem Statements`;
}
