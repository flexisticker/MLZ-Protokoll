// Test-Attrappen für die Entwicklung (nicht im Docker-Image):
//   Whisper (speaches) auf Port 8099 und ein Zeitstempeldienst (RFC 3161, openssl) auf Port 8098.
//   node test/mock-services.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const DIR = path.resolve('test/.tsa');
fs.mkdirSync(DIR, { recursive: true });
const f = (n) => path.join(DIR, n);
if (!fs.existsSync(f('tsa.crt'))) {
  fs.writeFileSync(f('ext.cnf'), 'basicConstraints=CA:FALSE\nextendedKeyUsage=critical,timeStamping\nkeyUsage=critical,digitalSignature\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('ca.key'), '-out', f('ca.crt'), '-days', '3650', '-subj', '/CN=Test-Wurzel']);
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('tsa.key'), '-out', f('tsa.csr'), '-subj', '/CN=Test-Zeitstempel']);
  execFileSync('openssl', ['x509', '-req', '-in', f('tsa.csr'), '-CA', f('ca.crt'), '-CAkey', f('ca.key'), '-CAcreateserial', '-out', f('tsa.crt'), '-days', '3650', '-extfile', f('ext.cnf')]);
  fs.writeFileSync(f('serial'), '01\n');
  fs.writeFileSync(f('ts.cnf'), `[ tsa ]\ndefault_tsa = tsa_config\n[ tsa_config ]\ndir = ${DIR}\nserial = $dir/serial\nsigner_cert = $dir/tsa.crt\nsigner_key = $dir/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\ndigests = sha256\naccuracy = secs:1\ness_cert_id_alg = sha256\ncrypto_device = builtin\n`);
}

const text = process.env.MOCK_TEXT || 'Heute um halb acht angefangen, 30 Minuten Pause, Feierabend um 17 Uhr. Herr Maier hat die Überstunden angeordnet.';
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'Systran/faster-whisper-small' }] })); return; }
  if (req.method === 'POST' && req.url.startsWith('/v1/models/')) { res.writeHead(201); res.end('{}'); return; }
  if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
    let n = 0; req.on('data', (c) => { n += c.length; });
    req.on('end', () => setTimeout(() => res.end(JSON.stringify({ text: `${text}` })), 800));
    return;
  }
  res.writeHead(404); res.end();
}).listen(8099, () => console.log('Whisper-Attrappe :8099'));

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      fs.writeFileSync(f('q.tsq'), Buffer.concat(chunks));
      execFileSync('openssl', ['ts', '-reply', '-config', f('ts.cnf'), '-queryfile', f('q.tsq'), '-out', f('r.tsr')], { stdio: 'pipe' });
      res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' });
      res.end(fs.readFileSync(f('r.tsr')));
    } catch (e) { res.writeHead(500); res.end(String(e.stderr || e)); }
  });
}).listen(8098, () => console.log('Zeitstempel-Attrappe :8098 (CA: test/.tsa/ca.crt)'));
