const { appendEvent, createEventId } = require('./_lib/store');

function sendJson(res, statusCode, body){
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sanitizeText(value, maxLength){
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sanitizeMultiline(value, maxLength){
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function sanitizeGeo(value){
  if(!value || typeof value !== 'object') return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    accuracy: Number.isFinite(Number(value.accuracy)) ? Math.round(Number(value.accuracy)) : null
  };
}

function parseBody(req){
  if(req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if(!raw) return resolve({});
      try{ resolve(JSON.parse(raw)); }
      catch(error){ reject(error); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if(req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try{
    const payload = await parseBody(req);
    const city = sanitizeText(req.headers['x-vercel-ip-city'], 80);
    const region = sanitizeText(req.headers['x-vercel-ip-country-region'], 80);
    const country = sanitizeText(req.headers['x-vercel-ip-country'], 40);
    const locationLabel = [city, region, country].filter(Boolean).join(', ');

    const event = {
      id: createEventId(),
      createdAt: new Date().toISOString(),
      candidateName: sanitizeText(payload.candidateName, 120),
      contactName: sanitizeText(payload.contactName, 120),
      phone: sanitizeText(payload.phone, 40),
      hashtag: sanitizeText(payload.hashtag, 80),
      coordination: sanitizeText(payload.coordination, 120),
      motto: sanitizeText(payload.motto, 120),
      sloganTag: sanitizeText(payload.sloganTag, 120),
      sloganSub: sanitizeText(payload.sloganSub, 220),
      headline: sanitizeMultiline(payload.headline, 280),
      language: sanitizeText(payload.language, 40),
      timezone: sanitizeText(payload.timezone, 60),
      screen: payload.screen && typeof payload.screen === 'object' ? {
        width: Number(payload.screen.width) || null,
        height: Number(payload.screen.height) || null
      } : null,
      geo: sanitizeGeo(payload.geo),
      networkLocation: { city, region, country, label: locationLabel || '' }
    };

    await appendEvent(event);
    return sendJson(res, 200, { ok: true, id: event.id });
  }catch(_error){
    return sendJson(res, 400, { error: 'Invalid payload' });
  }
};