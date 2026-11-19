import { ad, cad } from '../ui/cad.js';

// The example brief's routes (Sorrel & Oat, oat cleanser): six different angles on one proposition.
// Each route also names the kind of buyer it speaks to (who, why): the point of distinct routes is reaching more people.
// Used by the orbit, the why section, the board and the how section.
export const BRIEF = { brand: 'Sorrel & Oat', title: 'Oat cleanser, spring launch', line: 'Clean skin that still feels soft' };
export const ROUTES = [
  { id: 'proof', name: 'Proof', line: 'What changes in two weeks', acc: '#c4693f', who: 'Sensitive skin, 25 to 40', why: 'They want to see results before they buy again.', html: (s) => ad('proof', s) },
  { id: 'routine', name: 'Routine', line: 'Where it fits in the day', acc: '#1f5f9e', who: 'Working parents, 30 to 45', why: 'Skincare has to fit into five minutes.', html: (s) => ad('routine', s) },
  { id: 'ingredient', name: 'Ingredient', line: 'One thing on the label', acc: '#5e7f3e', who: 'Clean beauty shoppers', why: 'They read the label before anything else.', html: (s) => ad('ingredient', s) },
  { id: 'voice', name: 'Social proof', line: 'A real voice, not a claim', acc: '#8fb84e', who: 'First-time buyers', why: 'They trust reviews from people like them.',
    html: (s) => cad({ tpl: 'quote', quote: 'It didn’t sting. That’s a first.', who: 'Priya, 31 · sensitive skin', cta: 'Shop the cleanser', pal: ['#1f3b2d', '#f1ead8', '#b9d77e'] }, BRIEF.brand, 'bottle', s) },
  { id: 'versus', name: 'Comparison', line: 'Against what they use now', acc: '#a8782a', who: 'Foam cleanser users', why: 'They need a clear reason to switch.',
    html: (s) => cad({ tpl: 'split', top: 'After washing', a: ['Foam cleanser', 'Tight'], b: ['Sorrel & Oat', 'Soft'], cta: 'Feel the difference', pal: ['#f3ece2', '#3a2a20', '#c4693f'] }, BRIEF.brand, 'bottle', s) },
  { id: 'feel', name: 'Feeling', line: 'One word for how it feels', acc: '#e98aa2', who: 'Self-care fans, 22 to 35', why: 'They buy on how a thing makes them feel.',
    html: (s) => cad({ tpl: 'poster', word: 'SOFT', sub: 'Even on day one', cta: 'Shop the cleanser', pal: ['#f6d3da', '#5a2433', '#5a2433'] }, BRIEF.brand, 'bottle', s) },
];
// size names on the page and the class each kind of banner uses
export const SIZES = [
  { id: '11', label: '1:1', name: 'Feed, square', px: '1080 × 1080', ad: 's-11', cad: 'k-11' },
  { id: '45', label: '4:5', name: 'Feed, portrait', px: '1080 × 1350', ad: 's-45', cad: 'k-45' },
  { id: '916', label: '9:16', name: 'Stories and Reels', px: '1080 × 1920', ad: 's-916', cad: 'k-916' },
  { id: '191', label: '1.91:1', name: 'Landscape', px: '1200 × 628', ad: 's-191', cad: 'k-191' },
];
export const routeHTML = (r, sizeId = '45') => {
  const s = SIZES.find((x) => x.id === sizeId);
  return r.html(['proof', 'routine', 'ingredient'].includes(r.id) ? s.ad : s.cad);
};
// a banner in a fixed-ratio frame: .bn.r45 etc. (styled in sections.css); the frame decides the size, the banner fills it
export const banner = (r, sizeId = '45', cls = '') => `<div class="bn r${sizeId}${cls ? ` ${cls}` : ''}">${routeHTML(r, sizeId)}</div>`;
