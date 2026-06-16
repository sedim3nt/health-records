// In-memory demo store. Single source of truth for the session.
// Mutations replicate the server's logic closely enough to keep the views coherent.

import { buildBootstrap, packetPresets, computeMetrics } from './demoData.js';

let store = buildBootstrap();

function nowIso() {
  return new Date().toISOString();
}

function plusDays(dateInput, days) {
  const date = new Date(dateInput);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatDate(value) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// Find the mode (human/vet) and the expected record + parent event by record id.
function locateExpected(expectedRecordId) {
  for (const kind of ['human', 'vet']) {
    const mode = store.modes[kind];
    for (const event of mode.events) {
      const record = event.expectedRecords.find((r) => r.id === expectedRecordId);
      if (record) {
        return { kind, mode, event, record };
      }
    }
  }
  return null;
}

// Recompute event status from its expected records (mirrors refreshEventStatus).
function refreshEventStatus(event) {
  const statuses = event.expectedRecords.map((r) => r.status);

  if (statuses.length === 0) {
    event.status = 'pending';
    return;
  }

  if (statuses.every((s) => s === 'received')) {
    event.status = 'received';
  } else if (statuses.some((s) => s === 'received')) {
    event.status = 'partial';
  } else if (statuses.some((s) => s === 'requested')) {
    event.status = 'requested';
  } else {
    event.status = 'pending';
  }
}

// Rebuild the derived collections (metrics, documents, requestBoard) for a mode.
function rebuildDerived(kind) {
  const mode = store.modes[kind];
  mode.metrics = computeMetrics(mode.events);
  mode.requestBoard = mode.events
    .flatMap((event) =>
      event.expectedRecords
        .filter((record) => record.status !== 'received')
        .map((record) => ({
          id: record.id,
          recordType: record.recordType,
          status: record.status,
          eventTitle: event.title,
          startedAt: event.startedAt,
          providerName: event.providerName,
          requestCount: record.requestCount,
          nextFollowUpAt: record.nextFollowUpAt
        }))
    )
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

function pushAudit(kind, message) {
  const mode = store.modes[kind];
  mode.audit = [{ id: `audit-${Date.now()}`, message, createdAt: nowIso() }, ...mode.audit].slice(0, 8);
}

function providerName(mode, providerId) {
  return mode.providers.find((p) => p.id === providerId)?.name ?? 'Unlinked provider';
}

// --- Mutations ---

function sendRequest(expectedRecordId, kind = 'initial', channel = 'portal') {
  const located = locateExpected(expectedRecordId);
  if (!located) {
    throw new Error('Expected record not found.');
  }

  const { record, event } = located;
  record.requestCount = (record.requestCount || 0) + 1;
  record.lastRequestedAt = nowIso();
  record.nextFollowUpAt = plusDays(nowIso(), kind === 'follow-up' ? 2 : 3);

  if (record.status !== 'received') {
    record.status = 'requested';
  }

  refreshEventStatus(event);
  rebuildDerived(located.kind);
  pushAudit(
    located.kind,
    `${kind === 'follow-up' ? 'Follow-up sent' : 'Request sent'} for ${record.recordType}.`
  );

  return { ok: true };
}

function markReceived(expectedRecordId) {
  const located = locateExpected(expectedRecordId);
  if (!located) {
    throw new Error('Expected record not found.');
  }

  const { kind, mode, event, record } = located;
  record.status = 'received';
  record.nextFollowUpAt = null;
  record.receivedDocumentId = `doc-${record.id}`;

  // Synthesize a vault document so the searchable rail updates too.
  const year = event.startedAt.slice(0, 4);
  const provName = event.providerName;
  const title = `${event.startedAt.slice(0, 10)}_${slugify(provName)}_${slugify(record.recordType)}_received.txt`;
  const folder = kind === 'human' ? 'humans' : 'pets';

  if (!mode.documents.some((doc) => doc.id === `doc-${record.id}`)) {
    mode.documents = [
      {
        id: `doc-${record.id}`,
        title,
        recordType: record.recordType,
        documentDate: event.startedAt.slice(0, 10),
        status: 'verified',
        ocrText: `${record.recordType} for ${event.title}. Marked received in demo mode.`,
        providerName: provName,
        vaultPath: `runtime/vault/profiles/${folder}/${mode.profiles[0].slug}/documents/${year}/${title}`,
        tags: [`record type: ${record.recordType}`, `provider: ${provName}`]
      },
      ...mode.documents
    ];
  }

  refreshEventStatus(event);
  rebuildDerived(kind);
  pushAudit(kind, `Marked ${record.recordType} as received.`);

  return { ok: true };
}

function createEvent(payload) {
  const kind = store.modes.human.activeProfileId === payload.profileId ? 'human' : 'vet';
  const mode = store.modes[kind];
  const id = `event-demo-${Date.now()}`;
  const expectedRecordTypes = (payload.expectedRecordTypes || [])
    .map((value) => String(value).trim())
    .filter(Boolean);

  const event = {
    id,
    profileId: payload.profileId,
    providerId: payload.providerId,
    title: payload.title,
    eventType: payload.eventType,
    reason: payload.reason || '',
    bodyPart: payload.bodyPart || '',
    startedAt: payload.startedAt,
    status: 'pending',
    providerName: providerName(mode, payload.providerId),
    expectedRecords: expectedRecordTypes.map((recordType, index) => ({
      id: `er-demo-${Date.now()}-${index}`,
      eventId: id,
      recordType,
      expectedAfterDays: 0,
      status: 'pending',
      receivedDocumentId: null,
      requestCount: 0,
      lastRequestedAt: null,
      nextFollowUpAt: null
    }))
  };

  mode.events = [event, ...mode.events];
  rebuildDerived(kind);
  pushAudit(kind, `Created event ${payload.title}.`);

  return { ok: true };
}

// Mirror server selectPacketDocuments + buildPacketPreview.
function selectPacketDocuments(mode, presetKey) {
  const documents = mode.documents;
  let selected = documents.slice(0, 4);

  if (presetKey === 'surgery-consult') {
    selected = documents.filter((d) =>
      ['imaging report', 'visit note', 'consult note', 'operative note'].includes(d.recordType)
    );
  } else if (presetKey === 'appeal-support') {
    selected = documents.filter(
      (d) => d.tags.some((tag) => tag.includes('topic')) || d.recordType.includes('lab')
    );
  } else if (presetKey === 'emergency-now') {
    selected = documents.filter((d) =>
      ['lab report', 'discharge note', 'medication list', 'procedure note'].includes(d.recordType)
    );
  } else if (presetKey === 'new-clinic') {
    selected = documents.slice(0, 5);
  } else if (presetKey === 'chronic-care') {
    selected = documents.filter((d) =>
      ['lab report', 'lab results', 'imaging report', 'consult note', 'lab panel'].includes(d.recordType)
    );
  }

  if (selected.length === 0) {
    selected = documents.slice(0, 3);
  }

  return selected;
}

function buildPacketPreview(kind, presetKey) {
  const mode = store.modes[kind];
  const selected = selectPacketDocuments(mode, presetKey);

  return {
    generatedAt: nowIso(),
    count: selected.length,
    presetKey,
    manifest: selected.map((document, index) => ({
      line: index + 1,
      title: document.title,
      recordType: document.recordType,
      providerName: document.providerName,
      documentDate: document.documentDate
    }))
  };
}

function exportPacket(kind, presetKey) {
  const preview = buildPacketPreview(kind, presetKey);
  const profile = store.modes[kind].profiles[0];
  const timestamp = nowIso().replace(/[:.]/g, '-');
  const folderName = `${timestamp}_${slugify(profile.displayName)}_${slugify(presetKey)}`;
  const exportDir = `runtime/generated/packets/${folderName}`;

  pushAudit(kind, `Generated packet export ${folderName}.`);

  return {
    ...preview,
    exportDir,
    files: [`${exportDir}/manifest.json`, `${exportDir}/summary.txt`, `${exportDir}/documents`]
  };
}

// Add an AI-extracted record into the in-memory vault as a standalone document.
function addExtractedDocument(kind, extracted) {
  const mode = store.modes[kind];
  const documentDate = extracted.date || nowIso().slice(0, 10);
  const recordType = extracted.recordType || 'imported document';
  const provName = extracted.provider || 'Unlinked provider';
  const year = String(documentDate).slice(0, 4);
  const folder = kind === 'human' ? 'humans' : 'pets';
  const id = `doc-extracted-${Date.now()}`;
  const title = `${documentDate}_${slugify(provName)}_${slugify(recordType)}_extracted.txt`;

  const tags = [`record type: ${recordType}`, `provider: ${provName}`];
  for (const dx of extracted.diagnoses || []) {
    tags.push(`diagnosis: ${dx}`);
  }
  for (const med of extracted.medications || []) {
    tags.push(`medication: ${med}`);
  }

  mode.documents = [
    {
      id,
      title,
      recordType,
      documentDate,
      status: 'review-needed',
      ocrText: extracted.summary || '',
      providerName: provName,
      vaultPath: `runtime/vault/profiles/${folder}/${mode.profiles[0].slug}/documents/${year}/${title}`,
      tags
    },
    ...mode.documents
  ];

  pushAudit(kind, `Imported AI-extracted ${recordType}.`);
  return { ok: true, documentId: id };
}

// --- Router: resolve a prototype /api/* request against the store ---

function snapshot() {
  // Return a fresh shallow-cloned bootstrap so React sees a new object each load.
  return JSON.parse(JSON.stringify({ ...store, generatedAt: nowIso() }));
}

async function handleDemoRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let body = {};

  if (options.body && !(options.body instanceof FormData)) {
    try {
      body = JSON.parse(options.body);
    } catch {
      body = {};
    }
  }

  if (path === '/api/bootstrap' && method === 'GET') {
    return snapshot();
  }

  if (path === '/api/events' && method === 'POST') {
    return createEvent(body);
  }

  if (path === '/api/watcher/scan' && method === 'POST') {
    pushAudit('human', 'Inbound folder scan finished (demo, nothing queued).');
    return { ok: true, ingested: 0 };
  }

  if (path === '/api/import' && method === 'POST') {
    // FormData uploads are no-ops in demo mode.
    return { ok: true, imported: [] };
  }

  if (path === '/api/packets/preview' && method === 'POST') {
    return buildPacketPreview(body.kind, body.presetKey);
  }

  if (path === '/api/packets/export' && method === 'POST') {
    return exportPacket(body.kind, body.presetKey);
  }

  const expectedMatch = path.match(/^\/api\/expected-records\/([^/]+)\/(request|follow-up|receive)$/);
  if (expectedMatch && method === 'POST') {
    const [, expectedRecordId, action] = expectedMatch;
    if (action === 'request') {
      return sendRequest(expectedRecordId, 'initial', body.channel || 'portal');
    }
    if (action === 'follow-up') {
      return sendRequest(expectedRecordId, 'follow-up', body.channel || 'email');
    }
    return markReceived(expectedRecordId);
  }

  throw new Error(`Demo store has no handler for ${method} ${path}`);
}

// Resolve the active mode kind from a profile id (used by AI features).
function getKindForProfile(profileId) {
  return store.modes.human.activeProfileId === profileId ? 'human' : 'vet';
}

export {
  handleDemoRequest,
  addExtractedDocument,
  getKindForProfile,
  formatDate,
  packetPresets
};
