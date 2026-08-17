const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const LOCAL_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'acc-visual-generator-data')
  : path.join(process.cwd(), '.data');
const LOCAL_FILE = path.join(LOCAL_DIR, 'visual-events.json');
const KV_KEY = 'acc:visual-events';
const MAX_EVENTS = 1500;
const POSTGRES_TABLE = 'visual_events';

let pgPool = null;
let postgresInitPromise = null;

function getDatabaseUrl(){
  return process.env.POSTGRES_URL || process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || '';
}

function hasPostgresEnv(){
  return Boolean(getDatabaseUrl());
}

function hasKvEnv(){
  return Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    (process.env.KV_URL && process.env.KV_REST_API_TOKEN) ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

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
  if(hasPostgresEnv()) return 'postgres';
  return hasKvEnv() ? 'kv' : 'file';
}

function getPgPool(){
  if(!hasPostgresEnv()) return null;
  if(pgPool) return pgPool;
  try{
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: getDatabaseUrl() });
    return pgPool;
  }catch(_error){
    return null;
  }
}

async function ensurePostgresTable(){
  const pool = getPgPool();
  if(!pool) return false;
  if(!postgresInitPromise){
    postgresInitPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${POSTGRES_TABLE} (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL,
          event_data JSONB NOT NULL
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS ${POSTGRES_TABLE}_created_at_idx ON ${POSTGRES_TABLE} (created_at DESC)`);
      return true;
    })().catch(error => {
      postgresInitPromise = null;
      throw error;
    });
  }
  return postgresInitPromise;
}

async function readPostgresEvents(){
  const pool = getPgPool();
  if(!pool) return null;
  await ensurePostgresTable();
  const result = await pool.query(
    `SELECT event_data FROM ${POSTGRES_TABLE} ORDER BY created_at DESC LIMIT $1`,
    [MAX_EVENTS]
  );
  return result.rows.map(row => row.event_data).filter(item => item && typeof item === 'object');
}

async function appendPostgresEvent(event){
  const pool = getPgPool();
  if(!pool) return false;
  await ensurePostgresTable();
  await pool.query(
    `INSERT INTO ${POSTGRES_TABLE} (id, created_at, event_data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at, event_data = EXCLUDED.event_data`,
    [event.id, event.createdAt, JSON.stringify(event)]
  );
  await pool.query(
    `DELETE FROM ${POSTGRES_TABLE}
     WHERE id IN (
       SELECT id FROM ${POSTGRES_TABLE}
       ORDER BY created_at DESC
       OFFSET $1
     )`,
    [MAX_EVENTS]
  );
  return true;
}

async function appendKvEvent(event){
  const kv = await getKvClient();
  if(!kv) return false;
  const existing = await kv.get(KV_KEY);
  const list = Array.isArray(existing) ? existing : [];
  const next = [event, ...list].slice(0, MAX_EVENTS);
  await kv.set(KV_KEY, next);
  return true;
}

async function getKvClient(){
  if(!hasKvEnv()) return null;
  try{
    const packageRef = require('@vercel/kv');
    return packageRef.kv;
  }catch(_error){
    return null;
  }
}

async function getStoreInfo(){
  const mode = getStoreMode();
  if(mode === 'postgres'){
    const pool = getPgPool();
    if(!pool){
      return {
        mode: 'file',
        persistent: false,
        label: 'Postgres indisponible',
        hint: 'Les variables Postgres sont présentes, mais le client pg n’est pas disponible. Vérifie la dépendance et le déploiement.'
      };
    }
    try{
      await ensurePostgresTable();
      return {
        mode: 'postgres',
        persistent: true,
        label: 'Postgres connecté',
        hint: 'Les statistiques sont conservées de façon permanente dans la base Postgres.'
      };
    }catch(_error){
      return {
        mode: 'file',
        persistent: false,
        label: 'Postgres indisponible',
        hint: 'La connexion Postgres a échoué. Vérifie DATABASE_URL et le statut de la base.'
      };
    }
  }

  if(mode !== 'kv'){
    return {
      mode: 'file',
      persistent: false,
      label: process.env.VERCEL ? 'Fallback temporaire' : 'Fichier local',
      hint: process.env.VERCEL ? 'Ajoute Vercel KV pour conserver les stats durablement.' : 'Les stats sont enregistrées localement sur ce poste.'
    };
  }

  const kv = await getKvClient();
  if(!kv){
    return {
      mode: 'file',
      persistent: false,
      label: 'KV indisponible',
      hint: 'Les variables KV sont présentes, mais le client KV ne répond pas. Vérifie l’intégration Vercel KV.'
    };
  }

  return {
    mode: 'kv',
    persistent: true,
    label: 'Vercel KV connecté',
    hint: 'Les statistiques sont conservées de façon permanente dans Vercel KV.'
  };
}

async function readEvents(){
  if(hasPostgresEnv()){
    try{
      const stored = await readPostgresEvents();
      if(Array.isArray(stored)) return stored;
    }catch(_error){}
  }

  const kv = await getKvClient();
  if(kv){
    const stored = await kv.get(KV_KEY);
    return Array.isArray(stored) ? stored : [];
  }
  return readLocalEvents();
}

async function writeEvents(events){
  const next = events.slice(0, MAX_EVENTS);

  if(hasPostgresEnv()){
    const pool = getPgPool();
    if(pool){
      await ensurePostgresTable();
      await pool.query(`TRUNCATE TABLE ${POSTGRES_TABLE}`);
      for(const event of next){
        await appendPostgresEvent(event);
      }
      return;
    }
  }

  const kv = await getKvClient();
  if(kv){
    await kv.set(KV_KEY, next);
    return;
  }
  writeLocalEvents(next);
}

async function appendEvent(event){
  if(hasPostgresEnv()){
    try{
      const done = await appendPostgresEvent(event);
      if(done){
        return {
          event,
          store: {
            mode: 'postgres',
            persistent: true,
            label: 'Postgres connecté'
          }
        };
      }
    }catch(_error){}
  }

  try{
    const kvDone = await appendKvEvent(event);
    if(kvDone){
      return {
        event,
        store: {
          mode: 'kv',
          persistent: true,
          label: 'Vercel KV connecté'
        }
      };
    }
  }catch(_error){}

  const existing = await readEvents();
  const next = [event, ...existing].slice(0, MAX_EVENTS);
  await writeEvents(next);
  return {
    event,
    store: {
      mode: 'file',
      persistent: false,
      label: 'Fallback temporaire'
    }
  };
}

function createEventId(){
  if(typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'evt-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

module.exports = {
  appendEvent,
  createEventId,
  getStoreMode,
  getStoreInfo,
  readEvents
};