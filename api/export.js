const XLSX = require('xlsx');
const { readEvents } = require('./_lib/store');

function sendBinary(res, statusCode, body, filename){
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.end(body);
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
  const rows = events.map(event => ({
    Date: event.createdAt || '',
    'Nom militant': event.contactName || '',
    Telephone: event.phone || '',
    Coordination: event.coordination || '',
    'Nom sur visuel': event.candidateName || '',
    Hashtag: event.hashtag || '',
    'Etiquette slogan': event.sloganTag || '',
    'Sous-titre': event.sloganSub || '',
    'Titre principal': event.headline || '',
    'Localisation reseau': (event.networkLocation && event.networkLocation.label) || '',
    'Coordonnees GPS': event.geo ? event.geo.lat + ', ' + event.geo.lng : '',
    'Fuseau horaire': event.timezone || '',
    Langue: event.language || ''
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 22 }, { wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 18 }, { wch: 22 },
    { wch: 34 }, { wch: 28 }, { wch: 30 }, { wch: 22 }, { wch: 24 }, { wch: 14 }
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Visuels');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return sendBinary(res, 200, buffer, 'acc-visuels-export.xlsx');
};