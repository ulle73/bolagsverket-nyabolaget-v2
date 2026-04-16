import { readFile } from 'node:fs/promises';
import path from 'node:path';

const targetDate = process.argv[2];

if (!targetDate) {
  console.error('Usage: node email-and-phones.js YYYY-MM-DD');
  process.exit(1);
}

const filePath = path.resolve('output', `${targetDate}.json`);

const fileContent = await readFile(filePath, 'utf8');
const companies = JSON.parse(fileContent);

const withEmail = companies.filter((c) => c['E-post']).length;
const withPhone = companies.filter((c) => c.Telefon).length;

console.log(`Total: ${companies.length}`);
console.log(`With email: ${withEmail}`);
console.log(`With phone: ${withPhone}`);