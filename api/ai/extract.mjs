// POST { text } -> structured record JSON.
import { chat, parseJsonLoose, readJsonBody, sendJson, hasKey } from '../_openrouter.mjs';

const SYSTEM = `You are a medical-records parser. Read the raw text of a single health record
(human or veterinary) and extract structured fields. Respond with ONLY a JSON object, no prose, with keys:
recordType (string), provider (string), date (string, ISO YYYY-MM-DD if present else best guess),
diagnoses (array of strings), medications (array of strings), followUps (array of strings),
summary (one or two plain-language sentences). Use empty arrays/strings when unknown. Do not invent specifics.`;

function fallback(text) {
  const lower = (text || '').toLowerCase();
  let recordType = 'clinical note';
  if (lower.includes('discharge')) recordType = 'discharge note';
  else if (lower.includes('lab') || lower.includes('panel')) recordType = 'lab report';
  else if (lower.includes('mri') || lower.includes('x-ray') || lower.includes('imaging') || lower.includes('echocardiogram'))
    recordType = 'imaging report';
  else if (lower.includes('vaccine') || lower.includes('immuniz')) recordType = 'immunization record';
  else if (lower.includes('prescription') || lower.includes('refill')) recordType = 'prescription';

  const dateMatch = (text || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const snippet = (text || '').replace(/\s+/g, ' ').trim().slice(0, 180);

  return {
    recordType,
    provider: '',
    date: dateMatch ? dateMatch[1] : '',
    diagnoses: [],
    medications: [],
    followUps: [],
    summary: snippet
      ? `Offline extraction (no AI key set). Detected a ${recordType}. Excerpt: ${snippet}`
      : `Offline extraction (no AI key set). Detected a ${recordType}.`
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const text = (body.text || '').toString();

  if (!text.trim()) {
    return sendJson(res, 400, { error: 'Provide record text in { text }.' });
  }

  if (!hasKey()) {
    return sendJson(res, 200, fallback(text));
  }

  try {
    const content = await chat({
      system: SYSTEM,
      user: `Record text:\n\n${text.slice(0, 8000)}`,
      temperature: 0.1
    });
    const parsed = parseJsonLoose(content);

    return sendJson(res, 200, {
      recordType: parsed.recordType || '',
      provider: parsed.provider || '',
      date: parsed.date || '',
      diagnoses: Array.isArray(parsed.diagnoses) ? parsed.diagnoses : [],
      medications: Array.isArray(parsed.medications) ? parsed.medications : [],
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
      summary: parsed.summary || ''
    });
  } catch {
    return sendJson(res, 200, fallback(text));
  }
}
