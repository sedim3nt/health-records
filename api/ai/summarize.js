// POST { records } -> { summary } plain-language history overview.
import { chat, readJsonBody, sendJson, hasKey } from '../_openrouter.js';

const DISCLAIMER = 'This summary is for organizational purposes only and is not medical advice; consult a licensed clinician.';

const SYSTEM = `You are a careful health-records assistant. Given a list of a single patient's records,
write a concise plain-language overview (about 4-6 sentences) covering: the patient's recent care history,
current medications, and any open follow-ups or pending items. Be factual and only use the supplied records.
End with this exact disclaimer sentence: "${DISCLAIMER}"`;

function fallback(records) {
  const list = Array.isArray(records) ? records : [];

  if (list.length === 0) {
    return `No records were available to summarize. ${DISCLAIMER}`;
  }

  const types = [...new Set(list.map((r) => r.recordType).filter(Boolean))];
  const providers = [...new Set(list.map((r) => r.providerName).filter(Boolean))];
  const dates = list.map((r) => r.documentDate).filter(Boolean).sort();
  const meds = list
    .filter((r) => /medication|prescription|rx/i.test(`${r.recordType} ${r.text || ''}`))
    .map((r) => r.title);

  const parts = [
    `Offline summary (no AI key set). This vault holds ${list.length} record${list.length === 1 ? '' : 's'}` +
      (types.length ? ` spanning ${types.join(', ')}` : '') +
      (dates.length ? `, dated ${dates[0]} through ${dates[dates.length - 1]}` : '') +
      '.',
    providers.length ? `Care was delivered across ${providers.join(', ')}.` : '',
    meds.length ? `Medication-related records: ${meds.join('; ')}.` : 'No medication records were detected.',
    DISCLAIMER
  ];

  return parts.filter(Boolean).join(' ');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const records = Array.isArray(body.records) ? body.records : [];

  if (!hasKey()) {
    return sendJson(res, 200, { summary: fallback(records) });
  }

  try {
    const compact = records.map((r) => ({
      type: r.recordType,
      date: r.documentDate,
      provider: r.providerName,
      text: (r.text || '').slice(0, 600)
    }));

    const summary = await chat({
      system: SYSTEM,
      user: `Patient records (JSON):\n\n${JSON.stringify(compact, null, 2)}`,
      temperature: 0.3
    });

    return sendJson(res, 200, { summary: summary.trim() });
  } catch {
    return sendJson(res, 200, { summary: fallback(records) });
  }
}
