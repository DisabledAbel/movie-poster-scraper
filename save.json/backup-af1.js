#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const AF1_URL = process.env.AF1_BACKUP_URL || 'https://www.theaf1.com/schedule';
const BACKUP_DIR = path.resolve('save.json', 'backups');

async function run() {
  const res = await fetch(AF1_URL);
  if (!res.ok) throw new Error(`Failed to fetch AF1 site: ${res.status}`);
  const html = await res.text();

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const file = path.join(BACKUP_DIR, `af1-schedule-${stamp}.html`);
  await fs.writeFile(file, html, 'utf8');

  console.log(`Backed up AF1 schedule page to ${file}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
