// POST { provider, patient, recordType, dateRange } -> { letter }.
import { chat, readJsonBody, sendJson, hasKey } from '../_openrouter.js';

const SYSTEM = `You write polished, professional medical-records request letters that a patient (or pet owner)
can send to a provider. Cite the patient's right to access their own records (for humans, reference HIPAA's
right of access under 45 CFR 164.524; for veterinary records, reference the owner's right to request copies).
Keep it courteous and ready to send: include a subject line, a clear request specifying the record type and
date(s), preferred delivery format, and a polite closing with a signature placeholder. Output only the letter text.`;

function fallback({ provider, patient, recordType, dateRange }) {
  const today = new Date().toLocaleDateString();
  return `Subject: Request for Copies of Medical Records — ${recordType}

${today}

${provider}
Medical Records / Release of Information

To Whom It May Concern:

I am writing to formally request copies of my medical records, specifically the ${recordType} associated with care provided on or around ${dateRange}, for ${patient}.

Under my right to access my own health information (HIPAA right of access, 45 CFR 164.524), I am entitled to receive a copy of these records. Please provide them in electronic (PDF) format where possible, or by secure mail if electronic delivery is unavailable.

If any forms, identity verification, or a reasonable cost-based fee are required to fulfill this request, please let me know in advance and I will respond promptly. I would appreciate receiving these records within 30 days.

Thank you for your time and assistance.

Sincerely,

${patient}
[Phone] · [Email] · [Date of birth / patient identifier]

(Generated offline — no AI key set. Review before sending.)`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const provider = (body.provider || 'the provider').toString();
  const patient = (body.patient || 'the patient').toString();
  const recordType = (body.recordType || 'medical records').toString();
  const dateRange = (body.dateRange || 'the relevant visit').toString();

  if (!hasKey()) {
    return sendJson(res, 200, { letter: fallback({ provider, patient, recordType, dateRange }) });
  }

  try {
    const letter = await chat({
      system: SYSTEM,
      user: `Provider: ${provider}\nPatient/owner: ${patient}\nRecord type requested: ${recordType}\nDate or date range: ${dateRange}`,
      temperature: 0.4,
      maxTokens: 700
    });

    return sendJson(res, 200, { letter: letter.trim() });
  } catch {
    return sendJson(res, 200, { letter: fallback({ provider, patient, recordType, dateRange }) });
  }
}
