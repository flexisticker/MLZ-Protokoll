// Test-Attrappe für die Entwicklung (nicht im Docker-Image): Zeitstempeldienst (RFC 3161, openssl) auf Port 8098.
// Spracherkennung im Test: WHISPER_BIN=test/fake-whisper.sh (siehe README).
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

// ------------------------------------------------------------ KI-Attrappen
// Ollama auf Port 8097 (OLLAMA-Adresse http://127.0.0.1:8097), Claude auf Port 8096 (CLAUDE_BASE_URL=http://127.0.0.1:8096).
const blank = { kind: 'incident', title: '', category: '', eventDate: '', eventTime: '', eventEnd: '', location: '', persons: '', witnesses: '', facts: '', quotes: '', consequences: '', reaction: '', assessment: '',
  time: { date: '', start: '', end: '', breakMinutes: 0, orderedBy: '', how: '', reason: '' },
  absence: { type: '', from: '', to: '', half: false, approvedBy: '' },
  brtime: { date: '', start: '', end: '', outside: false, topic: '', place: '', abmeldungTo: '' }, missing: [] };
function fakeExtract(prompt) {
  const today = (prompt.match(/der (\d{4}-\d\d-\d\d)/) || [])[1] || '2026-10-24';
  const text = (prompt.split('"""')[1] || '').trim();
  if (/urlaub/i.test(text)) return { ...blank, kind: 'absence', absence: { type: 'urlaub', from: '2026-12-28', to: '2026-12-30', half: false, approvedBy: 'Frau Schulz' }, missing: [] };
  if (/angefangen|feierabend/i.test(text) && !/angeschrien|gesagt/i.test(text)) return { ...blank, kind: 'time', time: { ...blank.time, date: today, start: '07:30', end: '17:00', breakMinutes: 30, orderedBy: 'Herr Maier', how: 'angeordnet' } };
  return { ...blank, kind: /betriebsrat/i.test(text) ? 'br' : 'incident', title: 'Anweisung zu Überstunden in Halle 2', category: 'Anweisung / Druck', eventDate: today, eventTime: '10:00',
    location: 'Halle 2', persons: 'Herr Maier (Abteilungsleiter)', witnesses: 'Frau Schulz',
    facts: 'Herr Maier sprach mich in Halle 2 laut an und wies mich an, heute bis 19 Uhr zu bleiben.', quotes: 'Herr Maier: „Das ist nicht verhandelbar.“',
    consequences: 'Ich muss heute bis 19 Uhr arbeiten.', reaction: 'Ich habe gesagt, dass ich das dem Betriebsrat melde.', assessment: 'Ich habe mich unter Druck gesetzt gefühlt.', missing: ['Hat noch jemand die Anweisung gehört?'] };
}
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b-instruct' }] })); return; }
    if (req.url === '/api/pull') { res.write(`${JSON.stringify({ status: 'pulling manifest' })}\n`); res.write(`${JSON.stringify({ status: 'downloading', total: 100, completed: 100 })}\n`); res.end(`${JSON.stringify({ status: 'success' })}\n`); return; }
    if (req.url === '/api/chat') {
      if (body.model !== 'qwen2.5:7b-instruct') { res.writeHead(404); res.end(JSON.stringify({ error: `model "${body.model}" not found, try pulling it first` })); return; }
      const user = body.messages.find((m) => m.role === 'user').content;
      setTimeout(() => res.end(JSON.stringify({ message: { role: 'assistant', content: JSON.stringify(fakeExtract(user)) }, done: true })), 1500);
      return;
    }
    res.writeHead(404); res.end('{}');
  });
}).listen(8097, () => console.log('Ollama-Attrappe :8097'));

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.headers['x-api-key'] !== 'sk-ant-test' && req.headers.authorization !== 'Bearer sk-ant-test') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const out = fakeExtract(body.messages[0].content);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }));
  });
}).listen(8096, () => console.log('Claude-Attrappe :8096'));
