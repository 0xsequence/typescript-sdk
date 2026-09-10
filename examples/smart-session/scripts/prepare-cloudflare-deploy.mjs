import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageRoot = new URL('../', import.meta.url);
const localEnvironmentPath = new URL('.env.cloudflare.local', packageRoot);
if (existsSync(localEnvironmentPath)) {
  process.loadEnvFile(fileURLToPath(localEnvironmentPath));
}

const walletOrigin = deploymentOrigin(
  process.env.SMART_SESSION_WALLET_ORIGIN,
  'SMART_SESSION_WALLET_ORIGIN'
);
const dashboardOrigin = deploymentOrigin(
  process.env.SMART_SESSION_DASHBOARD_ORIGIN,
  'SMART_SESSION_DASHBOARD_ORIGIN'
);
if (walletOrigin === dashboardOrigin) {
  fail('SMART_SESSION_WALLET_ORIGIN and SMART_SESSION_DASHBOARD_ORIGIN must be different');
}

const databaseId = process.env.SMART_SESSION_D1_DATABASE_ID?.trim();
if (
  !databaseId ||
  databaseId === '00000000-0000-0000-0000-000000000000' ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)
) {
  fail('SMART_SESSION_D1_DATABASE_ID must be the D1 database UUID returned by Wrangler');
}

const sourcePath = new URL('wrangler.jsonc', packageRoot);
const outputPath = new URL('wrangler.deploy.generated.json', packageRoot);
const config = JSON.parse(readFileSync(sourcePath, 'utf8'));
const database = config.d1_databases?.find(({ binding }) => binding === 'DB');
if (!database) fail('wrangler.jsonc is missing the DB binding');

database.database_id = databaseId;
config.vars = {
  ...config.vars,
  WALLET_ORIGIN: walletOrigin,
  DASHBOARD_ORIGIN: dashboardOrigin
};
config.routes = [
  { pattern: new URL(walletOrigin).hostname, custom_domain: true },
  { pattern: new URL(dashboardOrigin).hostname, custom_domain: true }
];
config.workers_dev = false;
config.preview_urls = false;

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared ${fileURLToPath(outputPath)}`);
console.log(`Wallet:    ${walletOrigin}`);
console.log(`Dashboard: ${dashboardOrigin}`);

function deploymentOrigin(value, name) {
  if (!value?.trim())
    fail(`${name} is missing; copy .env.cloudflare.example to .env.cloudflare.local`);
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      isPlaceholderHostname(url.hostname)
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    fail(`${name} must be a non-placeholder HTTPS origin without a path`);
  }
}

function isPlaceholderHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'example.com' ||
    normalized.endsWith('.example.com') ||
    normalized.endsWith('.invalid') ||
    normalized.includes('replace-me')
  );
}

function fail(message) {
  console.error(`Cloudflare deployment configuration error: ${message}`);
  process.exit(1);
}
