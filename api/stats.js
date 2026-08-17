const { getStoreMode, readEvents } = require('./_lib/store');

function sendJson(res, statusCode, body){
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function startOfToday(){
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function makeKey(date){
  return date.toISOString().slice(0, 10);
}

function titleCase(label){
  return String(label || '').trim() || 'Non renseigné';
}

function countBy(items, selector){
  const map = new Map();
  items.forEach(item => {
    const key = titleCase(selector(item));
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function buildTrend(events){
  const points = [];
  const now = new Date();
  for(let offset = 13; offset >= 0; offset--){
    const day = new Date(now);
    day.setDate(now.getDate() - offset);
    day.setHours(0, 0, 0, 0);
    points.push({
      key: makeKey(day),
      label: day.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      count: 0
    });
  }
  const index = new Map(points.map(point => [point.key, point]));
  events.forEach(event => {
    const key = String(event.createdAt || '').slice(0, 10);
    if(index.has(key)) index.get(key).count += 1;
  });
  return points;
}

function buildLocations(events){
  const map = new Map();
  events.forEach(event => {
    const label = event.networkLocation && event.networkLocation.label ? event.networkLocation.label : (event.geo ? 'Coordonnées GPS' : 'Non renseigné');
    const current = map.get(label) || { label, count: 0, coordinates: '' };
    current.count += 1;
    if(event.geo && !current.coordinates){
      current.coordinates = event.geo.lat + ', ' + event.geo.lng;
    }
    map.set(label, current);
  });
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 20);
}

module.exports = async (req, res) => {
  if(req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const requiredToken = process.env.BACKOFFICE_TOKEN;
  const providedToken = (req.query && req.query.token) || req.headers['x-admin-token'] || '';
  if(requiredToken && providedToken !== requiredToken){
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  const events = await readEvents();
  const today = startOfToday().getTime();
  const last7 = today - (6 * 24 * 60 * 60 * 1000);

  const summary = {
    total: events.length,
    today: events.filter(event => new Date(event.createdAt).getTime() >= today).length,
    last7Days: events.filter(event => new Date(event.createdAt).getTime() >= last7).length,
    locationCount: buildLocations(events).filter(item => item.label !== 'Non renseigné').length
  };

  const payload = {
    storeMode: getStoreMode(),
    summary,
    trend: buildTrend(events),
    topCoordinations: countBy(events, event => event.coordination),
    locations: buildLocations(events),
    recent: events.slice(0, 30).map(event => ({
      candidateName: event.candidateName,
      contactName: event.contactName,
      phone: event.phone,
      hashtag: event.hashtag,
      coordination: event.coordination,
      createdAt: event.createdAt,
      locationLabel: event.networkLocation && event.networkLocation.label ? event.networkLocation.label : (event.geo ? 'Coordonnées GPS' : 'Non renseigné')
    }))
  };

  return sendJson(res, 200, payload);
};