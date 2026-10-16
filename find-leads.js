#!/usr/bin/env node
// Kose Web lead finder: pulls local businesses from Google Maps (Places API, New)
// and writes every one it finds, plus a list of those with no proper website.
//
// Usage (Windows, in this folder):
//   node find-leads.js YOUR_API_KEY                 run Suffolk, up to 950 requests
//   node find-leads.js YOUR_API_KEY --max 300       stop after 300 requests
//   node find-leads.js YOUR_API_KEY --pages 2       fetch up to 40 results per search (uses more requests)
//   node find-leads.js --dry-run                    show what it would search, no key needed
//   node find-leads.js YOUR_API_KEY --county norfolk   use counties/norfolk.json instead
//
// Safe to stop (Ctrl+C) and re-run: finished searches are remembered in progress-<county>.json
// and skipped next time, so you never pay twice for the same search.

const fs = require('fs');
const path = require('path');

// ---------- settings ----------
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const DRY = args.includes('--dry-run');
const KEY = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a) && a.length > 20) || process.env.GOOGLE_MAPS_KEY;
const MAX_REQUESTS = parseInt(flag('max', '950'), 10);
const PAGES = Math.min(3, Math.max(1, parseInt(flag('pages', '1'), 10)));
const COUNTY = (flag('county', 'suffolk') || 'suffolk').toLowerCase();
const DIR = __dirname;

const DEFAULT_SUFFOLK = {
  county: 'Suffolk',
  // Google's address field for the county; results outside it are dropped
  countyMatch: ['Suffolk'],
  towns: [
    'Ipswich', 'Bury St Edmunds', 'Lowestoft', 'Felixstowe', 'Haverhill', 'Sudbury', 'Stowmarket',
    'Newmarket', 'Woodbridge', 'Beccles', 'Mildenhall', 'Bungay', 'Halesworth', 'Leiston', 'Saxmundham',
    'Hadleigh', 'Framlingham', 'Southwold', 'Aldeburgh', 'Eye', 'Needham Market', 'Brandon', 'Kesgrave',
    'Lavenham', 'Clare', 'Debenham', 'Wickham Market', 'Long Melford', 'Kessingland', 'Martlesham'
  ],
  categories: [
    'hairdresser', 'barber', 'beauty salon', 'nail salon', 'cafe', 'takeaway', 'restaurant',
    'fish and chips', 'bakery', 'butcher', 'florist', 'dog groomer', 'plumber', 'electrician',
    'builder', 'roofer', 'painter and decorator', 'landscape gardener', 'cleaning service',
    'window cleaner', 'locksmith', 'car mechanic garage', 'MOT centre', 'car wash', 'tyre shop',
    'driving instructor', 'personal trainer', 'tattoo studio', 'handyman', 'carpet fitter'
  ]
};

// Website links that don't count as a real site (still a lead)
const NOT_A_REAL_SITE = /facebook\.com|fb\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com\/|linktr\.ee|booksy\.com|fresha\.com|treatwell|setmore|square\.site|wa\.me|whatsapp|just-eat|justeat|deliveroo|ubereats|uber\.com|foodhub|checkatrade|mybuilder|ratedpeople|yell\.com|business\.site|localo|google\.com|g\.page|sites\.google/i;

// ---------- load county ----------
function loadCounty() {
  const f = path.join(DIR, 'counties', COUNTY + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  if (COUNTY === 'suffolk') {
    fs.mkdirSync(path.join(DIR, 'counties'), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(DEFAULT_SUFFOLK, null, 2));
    return DEFAULT_SUFFOLK;
  }
  console.error(`No county file found at ${f}. Copy counties/suffolk.json, rename it, and change the towns.`);
  process.exit(1);
}

// ---------- progress ----------
const C = loadCounty();
const slug = C.county.toLowerCase().replace(/\s+/g, '-');
const PROGRESS = path.join(DIR, `progress-${slug}.json`);
let state = fs.existsSync(PROGRESS) ? JSON.parse(fs.readFileSync(PROGRESS, 'utf8')) : { done: {}, places: {}, requests: 0 };
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(state));

// ---------- Google Places ----------
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.nationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.primaryTypeDisplayName', 'places.businessStatus', 'places.googleMapsUri', 'places.location',
  'nextPageToken'
].join(',');

async function search(textQuery, pageToken) {
  const body = { textQuery, pageSize: 20, regionCode: 'GB', languageCode: 'en-GB' };
  if (pageToken) body.pageToken = pageToken;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(body)
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * attempt); continue; }
    if (res.status === 403 || res.status === 400) {
      console.error('\nGoogle refused the request:\n' + text.slice(0, 600));
      console.error('\nCheck: Places API (New) is enabled, billing is on, and the key is right.');
      process.exit(1);
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error('Google kept failing, try again later.');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const comp = (p, type) => (p.addressComponents || []).find(c => (c.types || []).includes(type))?.longText || '';

function websiteStatus(url) {
  if (!url) return 'None';
  if (NOT_A_REAL_SITE.test(url)) return 'Social / booking page only';
  return 'Has website';
}

// ---------- CSV ----------
function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function writeCsv(file, rows) {
  const H = ['Business name', 'Category', 'Searched as', 'Phone', 'Website status', 'Website', 'Rating', 'Reviews',
    'Address', 'Town', 'Postcode', 'Google Maps link', 'Latitude', 'Longitude', 'Place ID'];
  const lines = [H.join(',')].concat(rows.map(r => [r.name, r.type, r.searched, r.phone, r.webStatus, r.website, r.rating,
    r.reviews, r.address, r.town, r.postcode, r.maps, r.lat, r.lng, r.id].map(csvCell).join(',')));
  fs.writeFileSync(path.join(DIR, file), '﻿' + lines.join('\r\n'));
}

function exportCsvs() {
  const all = Object.values(state.places).sort((a, b) => (a.town + a.name).localeCompare(b.town + b.name));
  const leads = all.filter(r => r.webStatus !== 'Has website')
    .sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  writeCsv(`${slug}_all_businesses.csv`, all);
  writeCsv(`${slug}_no_website_leads.csv`, leads);
  return { all: all.length, leads: leads.length };
}

// ---------- main ----------
(async () => {
  const queries = [];
  for (const town of C.towns) for (const cat of C.categories) queries.push({ key: `${cat}|${town}`, text: `${cat} in ${town}, ${C.county}`, cat, town });
  const todo = queries.filter(q => !state.done[q.key]);

  console.log(`${C.county}: ${C.towns.length} towns x ${C.categories.length} categories = ${queries.length} searches`);
  console.log(`Already done: ${queries.length - todo.length}. Left: ${todo.length}. Request cap this run: ${MAX_REQUESTS}. Pages per search: ${PAGES}.`);

  if (DRY) {
    console.log('\nFirst 10 searches:'); todo.slice(0, 10).forEach(q => console.log('  ' + q.text));
    console.log(`\nWorst case this run uses ${Math.min(MAX_REQUESTS, todo.length * PAGES)} requests.`);
    return;
  }
  if (!KEY) { console.error('Add your API key: node find-leads.js YOUR_API_KEY'); process.exit(1); }

  let used = 0, stopReason = 'all searches finished';
  for (const q of todo) {
    let token, page = 0, capped = false;
    do {
      if (used >= MAX_REQUESTS) { stopReason = `hit the ${MAX_REQUESTS}-request cap`; capped = true; break; }
      const data = await search(q.text, token); used++; state.requests++; page++;
      for (const p of data.places || []) {
        if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
        const county = comp(p, 'administrative_area_level_2');
        if (county && !C.countyMatch.some(c => county.toLowerCase().includes(c.toLowerCase()))) continue;
        if (state.places[p.id]) continue;
        state.places[p.id] = {
          id: p.id, name: p.displayName?.text || '', type: p.primaryTypeDisplayName?.text || '', searched: q.cat,
          phone: p.nationalPhoneNumber || '', website: p.websiteUri || '', webStatus: websiteStatus(p.websiteUri),
          rating: p.rating ?? '', reviews: p.userRatingCount ?? 0, address: p.formattedAddress || '',
          town: comp(p, 'postal_town') || comp(p, 'locality') || q.town, postcode: comp(p, 'postal_code'),
          maps: p.googleMapsUri || '', lat: p.location?.latitude ?? '', lng: p.location?.longitude ?? ''
        };
      }
      token = data.nextPageToken;
      if (token) await sleep(1500);
    } while (token && page < PAGES);
    if (capped) break;
    state.done[q.key] = true;
    save();
    const n = Object.keys(state.places).length;
    process.stdout.write(`\r${Object.keys(state.done).length}/${queries.length} searches | ${used} requests this run | ${n} businesses found   `);
    await sleep(150);
  }
  save();
  const { all, leads } = exportCsvs();
  console.log(`\n\nStopped: ${stopReason}.`);
  console.log(`Total requests ever for ${C.county}: ${state.requests}`);
  console.log(`Saved ${slug}_all_businesses.csv (${all}) and ${slug}_no_website_leads.csv (${leads}).`);
  if (Object.keys(state.done).length < queries.length) console.log('Run the same command again (next month for free) to carry on where it stopped.');
})().catch(e => { save(); try { exportCsvs(); } catch {} console.error('\nError: ' + e.message + '\nProgress saved, just run it again.'); process.exit(1); });
