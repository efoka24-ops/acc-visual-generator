const { readEvents } = require('./_lib/store');

function sendText(res, statusCode, body, filename){
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.end(body);
}

function escapeCsv(value){
  const text = String(value || '').replace(/\r?\n/g, ' ');
  if(/[",;]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

module.exports = async (req, res) => {
  if(req.method !== 'GET'){
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const requiredToken = process.env.BACKOFFICE_TOKEN;
  const providedToken = (req.query && req.query.token) || req.headers['x-admin-token'] || '';
  if(requiredToken && providedToken !== requiredToken){
    res.statusCode = 401;
    return res.end('Unauthorized');
  }

  const events = await readEvents();
  const headers = [
    'Date',
    'Nom militant',
    'Telephone',
    'Coordination',
    'Nom sur visuel',
    'Hashtag',
    'Etiquette slogan',
    'Sous-titre',
    'Titre principal',
    'Localisation reseau',
    'Coordonnees GPS',
    'Fuseau horaire',
    'Langue'
  ];

  const rows = events.map(event => [
    event.createdAt || '',
    event.contactName || '',
    event.phone || '',
    event.coordination || '',
    event.candidateName || '',
    event.hashtag || '',
    event.sloganTag || '',
    event.sloganSub || '',
    event.headline || '',
    (event.networkLocation && event.networkLocation.label) || '',
    event.geo ? event.geo.lat + ', ' + event.geo.lng : '',
    event.timezone || '',
    event.language || ''
  ]);

  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsv).join(';')).join('\n');
  return sendText(res, 200, csv, 'acc-visuels-export.csv');
};