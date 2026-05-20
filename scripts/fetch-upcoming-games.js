#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const SCHEDULE_URL = 'https://www.theoregonlightning.com/schedule';
const TZ = 'America/Los_Angeles';
const OUTPUT_DIR = path.resolve('save.json');
const BACKUP_DIR = path.join(OUTPUT_DIR, 'backups');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'upcoming-games.json');

function toPstDate(dateStr, timeStr = '12:00 AM') {
  const raw = `${dateStr} ${timeStr}`.replace(/\s+/g, ' ').trim();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractGames(html) {
  const games = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const cols = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (cols.length < 2) continue;
    const [date, opponent, time = '', location = '', ...rest] = cols;
    if (!/\d/.test(date)) continue;
    games.push({ date, opponent, time, location, details: rest.join(' | ') });
  }
  return games;
}

function isUpcoming(game, now = new Date()) {
  const dt = toPstDate(game.date, game.time || '11:59 PM');
  return dt && dt.getTime() >= now.getTime();
}

async function run() {
  const res = await fetch(SCHEDULE_URL);
  if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.status}`);
  const html = await res.text();

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  await fs.writeFile(path.join(BACKUP_DIR, `oregon-lightning-schedule-${stamp}.html`), html, 'utf8');

  const allGames = extractGames(html);
  const nowInPst = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const upcoming = allGames.filter((g) => isUpcoming(g, nowInPst));

  const payload = {
    source: SCHEDULE_URL,
    timezone: 'PST/PDT (America/Los_Angeles)',
    fetchedAt: new Date().toISOString(),
    totalParsed: allGames.length,
    upcomingCount: upcoming.length,
    games: upcoming,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2));

  console.log(`Parsed ${allGames.length} games, found ${upcoming.length} upcoming games.`);
  console.log(`Saved to ${OUTPUT_FILE}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
