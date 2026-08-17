const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_DIR = path.join(process.cwd(), '.data');
const LOCAL_FILE = path.join(LOCAL_DIR, 'visual-events.json');
const KV_KEY = 'acc:visual-events';
const MAX_EVENTS = 1500;

function ensureLocalStore(){
  if(!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
  if(!fs.existsSync(LOCAL_FILE)) fs.writeFileSync(LOCAL_FILE, '[]', 'utf8');
}

function readLocalEvents(){
  ensureLocalStore();
  try{
    const raw = fs.readFileSync(LOCAL_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }catch(_error){
    return [];
  }
}

function writeLocalEvents(events){
  ensureLocalStore();
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(events.slice(0, MAX_EVENTS), null, 2), 'utf8');
}

function getStoreMode(){
  return process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN ? 'kv' : 'file';
}

async function getKvClient(){
  if(getStoreMode() !== 'kv') return null;
  try{
    const packageRef = require('@vercel/kv');
    return packageRef.kv;
  }catch(_error){
    return null;
  }
}

async function readEvents(){
  const kv = await getKvClient();
  if(kv){
    const stored = await kv.get(KV_KEY);
    return Array.isArray(stored) ? stored : [];
  }
  return readLocalEvents();
}

async function writeEvents(events){
  const next = events.slice(0, MAX_EVENTS);
  const kv = await getKvClient();
  if(kv){
    await kv.set(KV_KEY, next);
    return;
  }
  writeLocalEvents(next);
}

async function appendEvent(event){
  const existing = await readEvents();
  const next = [event, ...existing].slice(0, MAX_EVENTS);
  await writeEvents(next);
  return event;
}

function createEventId(){
  if(typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'evt-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

module.exports = {
  appendEvent,
  createEventId,
  getStoreMode,
  readEvents
};