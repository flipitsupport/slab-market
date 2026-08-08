/**
 * Seed demo data into Slab Market
 * ---------------------------------
 * Generates realistic-looking (fictional) card listings — each with a
 * generated card image and a mock "comp screenshot" — and posts them to
 * your live app so you have something to actually scroll through.
 *
 * Run it with:
 *   node seed-demo-data.js
 *
 * By default it targets your live Render URL below. Change TARGET_URL
 * if you want to seed a different server instead (e.g. localhost while
 * testing).
 */

const TARGET_URL = 'https://flipit-z1f7.onrender.com';

const TEAMS = [
  { name: 'Ironclad Athletics', c1: '#B24437', c2: '#EDEAE2' },
  { name: 'Riverside Voltage', c1: '#4A6FA5', c2: '#EDEAE2' },
  { name: 'Cascade Timberwolves', c1: '#3F8A5D', c2: '#EDEAE2' },
  { name: 'Granite City Miners', c1: '#57584E', c2: '#C7A03D' },
  { name: 'Harborlight Marlins', c1: '#2E6E7E', c2: '#EDEAE2' },
  { name: 'Redline Motors FC', c1: '#8A2E2E', c2: '#EDEAE2' },
];
const SPORTS = ['Baseball', 'Basketball', 'Hockey', 'Football'];
const SETS = ["Prestige Chrome '24", "Vantage Elite '23", "Skyline Draft '24", "Heritage Foil '22", "Apex Series '24"];
const PLAYERS = ['M. Alvarez', 'J. Okafor', 'T. Lindqvist', 'D. Whitfield', 'R. Castellano', 'K. Boateng', 'S. Marchetti', 'A. Novak', 'L. Petrosyan', 'C. Deshields'];
const SELLERS = ['hobbybox_dan', 'cardsbycass', 'rookiepulls', 'binder_becca', 'vault_wes', 'primenumbers22'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Generates a simple team-colored card illustration as an SVG data URL
function makeCardImage(team, sport, player) {
  const shapes = {
    Baseball: 'M50 20c-16 0-28 12-28 28 0 20 12 34 28 40 16-6 28-20 28-40 0-16-12-28-28-28z',
    Basketball: 'M50 15c-19 0-34 15-34 34s15 34 34 34 34-15 34-34-15-34-34-34zm0 6c9 0 16 6 20 14H30c4-8 11-14 20-14zm-22 20h44c1 3 1 6 1 8s0 5-1 8H28c-1-3-1-6-1-8s0-5 1-8z',
    Hockey: 'M20 60l22-30 16 12-8 6 22 4-8 14-24-4 6-8-26 6z',
    Football: 'M20 50c0-14 14-22 30-22s30 8 30 22-14 22-30 22-30-8-30-22zM32 42l36 16M40 36l20 28',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
    <rect width="300" height="300" fill="${team.c1}"/>
    <circle cx="150" cy="115" r="60" fill="${team.c2}" opacity="0.95"/>
    <path d="${shapes[sport]}" fill="${team.c1}" opacity="0.85" transform="translate(75,25) scale(1.5)"/>
    <text x="150" y="260" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${team.c2}">${player}</text>
    <text x="150" y="285" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="${team.c2}" opacity="0.8">${team.name}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// Generates a mock "sold listing" screenshot — clearly a generic
// illustration, not impersonating any real marketplace's actual UI
function makeCompScreenshot(player, price) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220">
    <rect width="400" height="220" fill="#F4F4F4"/>
    <rect x="0" y="0" width="400" height="36" fill="#2B2B2B"/>
    <text x="16" y="24" font-family="Arial, sans-serif" font-size="14" fill="#fff">Sold Listing (demo data)</text>
    <rect x="20" y="56" width="360" height="120" rx="8" fill="#fff" stroke="#ddd"/>
    <text x="40" y="90" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#111">${player}</text>
    <text x="40" y="115" font-family="Arial, sans-serif" font-size="13" fill="#666">Condition: Near Mint</text>
    <text x="40" y="155" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#1a7f37">SOLD — $${price}</text>
    <text x="20" y="205" font-family="Arial, sans-serif" font-size="11" fill="#999">This is a generated placeholder for demo purposes.</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function buildFakeListing() {
  const team = rand(TEAMS);
  const sport = rand(SPORTS);
  const player = rand(PLAYERS);
  const set = rand(SETS);
  const year = randInt(2021, 2024);
  const compPrice = randInt(30, 400);
  // Most listings priced somewhat below comp so the ranking mechanic has something to show
  const discountPct = randInt(-5, 40) / 100; // occasionally priced AT or slightly above comp too
  const price = Math.max(5, Math.round(compPrice * (1 - discountPct)));
  const grade = rand(['Raw', 'PSA 9', 'PSA 10', 'BGS 9.5', 'SGC 9']);

  return {
    sellerName: rand(SELLERS),
    name: `${year} ${set} ${player}`,
    sport,
    team: team.name,
    year: String(year),
    price,
    condition: grade === 'Raw' ? 'Raw' : grade.split(' ')[0],
    grade,
    details: 'Demo listing generated for testing — not a real card for sale.',
    photos: [makeCardImage(team, sport, player)],
    photo: null,
    compPrice,
    compScreenshot: makeCompScreenshot(`${year} ${set} ${player}`, compPrice),
  };
}

async function seed(count = 10) {
  console.log(`Seeding ${count} demo listings to ${TARGET_URL} ...`);
  let ok = 0, failed = 0;
  for (let i = 0; i < count; i++) {
    const listing = buildFakeListing();
    try {
      const res = await fetch(`${TARGET_URL}/api/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(listing),
      });
      if (res.ok) {
        ok++;
        console.log(`✓ ${listing.name} — $${listing.price} (comp $${listing.compPrice})`);
      } else {
        failed++;
        const err = await res.json().catch(() => ({}));
        console.log(`✗ Failed: ${err.error || res.status}`);
      }
    } catch (e) {
      failed++;
      console.log(`✗ Network error: ${e.message}`);
    }
  }
  console.log(`\nDone — ${ok} created, ${failed} failed.`);
}

seed(10);
