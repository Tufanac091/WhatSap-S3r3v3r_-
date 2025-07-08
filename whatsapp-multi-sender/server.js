const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

let sockets = {};
let isRunning = false;
let stopKey = '';

// Delay helper
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Load all sessions from creds/
async function loadAllSessions() {
  const credFolders = fs.readdirSync('creds').filter(f => 
    fs.existsSync(`creds/${f}/creds.json`)
  );
  for (const folder of credFolders) {
    const { state, saveCreds } = await useMultiFileAuthState(`creds/${folder}`);
    const sock = makeWASocket({ auth: state });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection }) => {
      if (connection === 'close') delete sockets[folder];
    });
    sockets[folder] = sock;
  }
}

app.get('/status', (req, res) => {
  res.send(`✅ Server running. Sessions: ${Object.keys(sockets).length}, Running: ${isRunning}`);
});

app.post('/start', upload.fields([
  { name: 'sms', maxCount: 1 },
  { name: 'numbers', maxCount: 1 },
]), async (req, res) => {
  if (isRunning) return res.send('⚠️ Already running');

  const delay = parseInt(req.body.delay || '2') * 1000;
  stopKey = req.body.key || '';
  const selectedSession = req.body.session;

  const messages = fs.readFileSync(req.files['sms'][0].path, 'utf-8').split('\n');
  const numbersRaw = fs.readFileSync(req.files['numbers'][0].path, 'utf-8').split('\n');

  if (!sockets[selectedSession]) return res.send('❌ Session not found');

  isRunning = true;
  const sock = sockets[selectedSession];

  for (let i = 0; i < Math.min(messages.length, numbersRaw.length); i++) {
    if (!isRunning) break;
    const [num, type] = numbersRaw[i].split(',').map(x => x.trim());
    const id = type === 'group' ? num : `${num}@s.whatsapp.net`;
    try {
      await sock.sendMessage(id, { text: messages[i] });
      console.log(`✅ Sent to ${id}: ${messages[i]}`);
    } catch (e) {
      console.log(`❌ Failed: ${id}`);
    }
    await sleep(delay);
  }

  isRunning = false;
  res.send('✅ Messages sent.');
});

app.post('/stop', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.key === stopKey) {
    isRunning = false;
    return res.send('🛑 Stopped by user.');
  } else {
    return res.send('❌ Invalid stop key.');
  }
});

loadAllSessions().then(() => {
  app.listen(port, () => console.log(`🚀 Server ready at http://localhost:${port}`));
});
