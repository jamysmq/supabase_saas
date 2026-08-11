import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const templateUrl = new URL('../supabase/templates/invite.html', import.meta.url);
const templatePath = fileURLToPath(templateUrl);

function fail(message) {
  console.error(`Account invite template check failed: ${message}`);
  process.exitCode = 1;
}

let html;

try {
  html = await readFile(templateUrl, 'utf8');
} catch (error) {
  console.error(`Account invite template check failed: could not read ${templatePath}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const requiredPlaceholders = [
  '{{ .Data.tenant_name }}',
  '{{ .Email }}',
  '{{ .ConfirmationURL }}',
];

const missingPlaceholders = requiredPlaceholders.filter(
  (placeholder) => !html.includes(placeholder),
);

if (missingPlaceholders.length > 0) {
  fail(`missing exact Supabase placeholder(s): ${missingPlaceholders.join(', ')}`);
}

const confirmationHrefPattern = /href\s*=\s*(["']){{ \.ConfirmationURL }}\1/i;
if (!confirmationHrefPattern.test(html)) {
  fail('{{ .ConfirmationURL }} must be used directly as an href value.');
}

const visibleText = html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const usernameLabelPattern = /(?:seu\s+)?usu[aá]rio\s*:\s*{{ \.Email }}/i;
if (!usernameLabelPattern.test(visibleText)) {
  fail('the username must be visibly labeled and immediately associated with {{ .Email }}.');
}

const temporaryPasswordPattern = /(?:(?:senha|password)\s+(?:tempor[aá]ri[ao]|provis[oó]ri[ao]|temporary|provisional)|(?:tempor[aá]ri[ao]|provis[oó]ri[ao]|temporary|provisional)\s+(?:senha|password))/i;
if (temporaryPasswordPattern.test(html)) {
  fail('temporary password wording is forbidden.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(
  'Account invite template check passed: 3 placeholders found, confirmation link is valid, username is labeled, and no temporary password wording was detected.',
);
