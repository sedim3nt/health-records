import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import formidable from 'formidable';
import { PDFParse } from 'pdf-parse';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(__dirname, '..');
const runtimeRoot = process.env.HEALTH_RECORDS_RUNTIME_ROOT
  ? resolve(process.env.HEALTH_RECORDS_RUNTIME_ROOT)
  : join(projectRoot, 'runtime');
const dbRoot = join(runtimeRoot, 'db');
const dbPath = join(dbRoot, 'health-records.sqlite');
const inboundRoot = join(runtimeRoot, 'inbound');
const inboundHuman = join(inboundRoot, 'human');
const inboundVet = join(inboundRoot, 'vet');
const inboundArchive = join(inboundRoot, 'archive');
const importRoot = join(runtimeRoot, 'imports');
const importOriginalRoot = join(importRoot, 'originals');
const vaultRoot = join(runtimeRoot, 'vault');
const generatedRoot = join(runtimeRoot, 'generated');
const packetOutputRoot = join(generatedRoot, 'packets');
const distRoot = join(projectRoot, 'dist');
const publicRoot = process.env.HEALTH_RECORDS_PUBLIC_ROOT
  ? resolve(process.env.HEALTH_RECORDS_PUBLIC_ROOT)
  : distRoot;
const scanIntervalMs = 2500;
const port = Number(process.env.PORT ?? 4179);
const demoSeedEnabled = process.env.HEALTH_RECORDS_DEMO_DATA === '1';

const packetPresets = {
  human: [
    {
      key: 'specialist-intake',
      name: 'Specialist intake',
      detail: 'Latest consult notes, imaging, labs, and medication history.'
    },
    {
      key: 'surgery-consult',
      name: 'Surgery consult',
      detail: 'Imaging-heavy packet with chronology and procedural context.'
    },
    {
      key: 'appeal-support',
      name: 'Appeal support',
      detail: 'Prior notes, failed-treatment trail, and supporting evidence.'
    }
  ],
  vet: [
    {
      key: 'emergency-now',
      name: 'Emergency now',
      detail: 'Current meds, recent labs, chronic issues, and the latest discharge context.'
    },
    {
      key: 'new-clinic',
      name: 'New clinic intake',
      detail: 'Last 12 months of core records plus vaccination and medication summaries.'
    },
    {
      key: 'chronic-care',
      name: 'Chronic care',
      detail: 'Trend-friendly packet built around repeat labs, imaging, and treatment changes.'
    }
  ]
};

for (const folder of [
  runtimeRoot,
  dbRoot,
  inboundRoot,
  inboundHuman,
  inboundVet,
  inboundArchive,
  importRoot,
  importOriginalRoot,
  vaultRoot,
  generatedRoot,
  packetOutputRoot
]) {
  mkdirSync(folder, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    subtitle TEXT,
    species TEXT,
    breed TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    specialty TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL REFERENCES providers(id),
    title TEXT NOT NULL,
    event_type TEXT NOT NULL,
    reason TEXT,
    body_part TEXT,
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expected_records (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    record_type TEXT NOT NULL,
    expected_after_days INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    required_for_completion INTEGER NOT NULL DEFAULT 1,
    received_document_id TEXT REFERENCES documents(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_attempts (
    id TEXT PRIMARY KEY,
    expected_record_id TEXT NOT NULL REFERENCES expected_records(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    channel TEXT NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    status TEXT NOT NULL,
    body_snapshot TEXT,
    next_follow_up_at TEXT
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider_id TEXT REFERENCES providers(id),
    source_event_id TEXT REFERENCES events(id),
    expected_record_id TEXT REFERENCES expected_records(id),
    title TEXT NOT NULL,
    record_type TEXT NOT NULL,
    document_date TEXT NOT NULL,
    source_path_original TEXT NOT NULL,
    vault_path_normalized TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    ocr_text TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_tags (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_type TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL
  );
`);

function nowIso() {
  return new Date().toISOString();
}

function plusDays(dateInput, days) {
  const date = new Date(dateInput);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function relativePath(pathname) {
  const resolved = relative(projectRoot, pathname) || '.';
  return resolved.startsWith('..') ? pathname : resolved;
}

function firstValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

function countFiles(pathname) {
  return readdirSync(pathname, { withFileTypes: true }).reduce((count, entry) => {
    const nextPath = join(pathname, entry.name);
    return count + (entry.isDirectory() ? countFiles(nextPath) : 1);
  }, 0);
}

function countDirectFiles(pathname) {
  return readdirSync(pathname, { withFileTypes: true }).reduce((count, entry) => {
    if (entry.name.startsWith('.')) {
      return count;
    }

    return count + (entry.isFile() ? 1 : 0);
  }, 0);
}

function writeSeedDocument(relativeVaultPath, content) {
  const fullPath = join(vaultRoot, relativeVaultPath);
  mkdirSync(dirname(fullPath), { recursive: true });

  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, content, 'utf8');
  }

  return fullPath;
}

function insertAudit(kind, message, metadata = {}) {
  db.prepare(
    'INSERT INTO audit_log (id, kind, message, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(randomUUID(), kind, message, JSON.stringify(metadata), nowIso());
}

function insertTags(documentId, values) {
  const insert = db.prepare(
    'INSERT INTO document_tags (id, document_id, tag_type, value, source) VALUES (?, ?, ?, ?, ?)'
  );

  for (const [tagType, tagValue] of values) {
    insert.run(randomUUID(), documentId, tagType, tagValue, 'system');
  }
}

function inferMimeType(filename = '') {
  switch (extname(filename).toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.txt':
    case '.md':
    case '.csv':
    case '.json':
      return 'text/plain';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

async function extractSearchText(filePath, mimeType, filename) {
  const extension = extname(filename).toLowerCase();

  if (mimeType.startsWith('text/') || ['.txt', '.md', '.csv', '.json'].includes(extension)) {
    return readFileSync(filePath, 'utf8').slice(0, 200000);
  }

  if (mimeType === 'application/pdf' || extension === '.pdf') {
    try {
      const parser = new PDFParse({ data: readFileSync(filePath) });
      const parsed = await parser.getText();
      await parser.destroy();
      return (parsed.text || '').slice(0, 200000);
    } catch {
      return '';
    }
  }

  return '';
}

function createDocumentRecord({
  profileId,
  providerId,
  sourceEventId = null,
  expectedRecordId = null,
  title,
  recordType,
  documentDate,
  sourcePathOriginal,
  vaultPathNormalized,
  mimeType,
  ocrText,
  status = 'verified'
}) {
  const sha256 = createHash('sha256').update(ocrText + title + sourcePathOriginal).digest('hex');
  const existing = db.prepare('SELECT id FROM documents WHERE sha256 = ?').get(sha256);

  if (existing) {
    return existing.id;
  }

  const id = randomUUID();

  db.prepare(
    `
      INSERT INTO documents (
        id, profile_id, provider_id, source_event_id, expected_record_id, title, record_type,
        document_date, source_path_original, vault_path_normalized, sha256, mime_type, ocr_text, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    profileId,
    providerId,
    sourceEventId,
    expectedRecordId,
    title,
    recordType,
    documentDate,
    sourcePathOriginal,
    vaultPathNormalized,
    sha256,
    mimeType,
    ocrText,
    status,
    nowIso()
  );

  return id;
}

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count;

  if (count > 0) {
    return;
  }

  const createdAt = nowIso();
  const insertProfile = db.prepare(
    'INSERT INTO profiles (id, kind, slug, display_name, subtitle, species, breed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertProvider = db.prepare(
    'INSERT INTO providers (id, kind, name, provider_type, specialty, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertEvent = db.prepare(
    'INSERT INTO events (id, profile_id, provider_id, title, event_type, reason, body_part, started_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertExpected = db.prepare(
    'INSERT INTO expected_records (id, event_id, record_type, expected_after_days, status, required_for_completion, received_document_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertAttempt = db.prepare(
    'INSERT INTO request_attempts (id, expected_record_id, attempt_number, channel, kind, sent_at, status, body_snapshot, next_follow_up_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  insertProfile.run(
    'profile-human-landon',
    'human',
    'landon-001',
    'Landon',
    'multi-specialist patient profile',
    null,
    null,
    createdAt
  );
  insertProfile.run(
    'profile-vet-poppy',
    'vet',
    'poppy-dog-001',
    'Poppy',
    'household pilot profile',
    'Dog',
    'Mixed breed',
    createdAt
  );

  const providers = [
    ['provider-ortho', 'human', 'Boulder Sports Medicine', 'clinic', 'Orthopedics'],
    ['provider-imaging', 'human', 'UCHealth Imaging', 'imaging', 'Radiology'],
    ['provider-neuro', 'human', 'Front Range Neurology', 'specialist', 'Neurology'],
    ['provider-vet-primary', 'vet', 'Foothills Veterinary', 'clinic', 'Primary care'],
    ['provider-vet-er', 'vet', 'All Pets Emergency', 'emergency', 'Emergency']
  ];

  for (const [id, kind, name, providerType, specialty] of providers) {
    insertProvider.run(id, kind, name, providerType, specialty, createdAt);
  }

  if (!demoSeedEnabled) {
    insertAudit('human', 'Initialized empty alpha human vault.', { seeded: false });
    insertAudit('vet', 'Initialized empty alpha vet vault.', { seeded: false });
    return;
  }

  const seedEvents = [
    {
      id: 'event-human-ortho',
      profileId: 'profile-human-landon',
      providerId: 'provider-ortho',
      title: 'Orthopedic follow-up',
      eventType: 'visit',
      reason: 'post-imaging consult',
      bodyPart: 'cervical spine',
      startedAt: '2026-04-22T15:00:00.000Z',
      status: 'requested',
      expectedRecords: [
        { id: 'expected-human-ortho-note', recordType: 'visit note', status: 'requested', afterDays: 0 },
        { id: 'expected-human-ortho-summary', recordType: 'after-visit summary', status: 'pending', afterDays: 0 }
      ],
      attempts: [
        {
          id: 'attempt-human-ortho-note-1',
          expectedRecordId: 'expected-human-ortho-note',
          attemptNumber: 1,
          channel: 'portal',
          kind: 'initial',
          sentAt: '2026-04-23T14:00:00.000Z',
          status: 'sent',
          body: 'Please send the visit note from the orthopedic follow-up on April 22.',
          nextFollowUpAt: '2026-04-26T14:00:00.000Z'
        }
      ]
    },
    {
      id: 'event-human-mri',
      profileId: 'profile-human-landon',
      providerId: 'provider-imaging',
      title: 'Cervical spine MRI',
      eventType: 'imaging',
      reason: 'neck pain workup',
      bodyPart: 'cervical spine',
      startedAt: '2026-04-18T18:30:00.000Z',
      status: 'partial',
      expectedRecords: [
        {
          id: 'expected-human-mri-report',
          recordType: 'imaging report',
          status: 'received',
          afterDays: 1,
          document: {
            title: '2026-04-18_uchealth_imaging-report_mri-cervical-spine.txt',
            vaultPath: 'profiles/humans/landon-001/documents/2026/2026-04-18_uchealth_imaging-report_mri-cervical-spine.txt',
            content:
              'MRI report. Findings: mild degenerative change at C5-C6. No acute cord signal abnormality.'
          }
        },
        { id: 'expected-human-mri-media', recordType: 'dicom media', status: 'requested', afterDays: 1 }
      ],
      attempts: [
        {
          id: 'attempt-human-mri-media-1',
          expectedRecordId: 'expected-human-mri-media',
          attemptNumber: 1,
          channel: 'email',
          kind: 'initial',
          sentAt: '2026-04-20T13:00:00.000Z',
          status: 'sent',
          body: 'Please release the DICOM imaging media for the April 18 MRI.',
          nextFollowUpAt: '2026-04-24T13:00:00.000Z'
        }
      ]
    },
    {
      id: 'event-human-neuro',
      profileId: 'profile-human-landon',
      providerId: 'provider-neuro',
      title: 'Neurology intake',
      eventType: 'visit',
      reason: 'headache episode',
      bodyPart: 'head',
      startedAt: '2026-04-11T17:00:00.000Z',
      status: 'received',
      expectedRecords: [
        {
          id: 'expected-human-neuro-note',
          recordType: 'consult note',
          status: 'received',
          afterDays: 0,
          document: {
            title: '2026-04-11_front-range-neurology_consult-note_headache.txt',
            vaultPath: 'profiles/humans/landon-001/documents/2026/2026-04-11_front-range-neurology_consult-note_headache.txt',
            content:
              'Neurology intake. Assessment: chronic headache, recommended medication review and imaging comparison.'
          }
        },
        {
          id: 'expected-human-neuro-meds',
          recordType: 'medication list',
          status: 'received',
          afterDays: 0,
          document: {
            title: '2026-04-11_front-range-neurology_medication-list_headache.txt',
            vaultPath: 'profiles/humans/landon-001/documents/2026/2026-04-11_front-range-neurology_medication-list_headache.txt',
            content: 'Medication list. Current meds: magnesium, riboflavin, as-needed triptan.'
          }
        }
      ],
      attempts: []
    },
    {
      id: 'event-vet-er',
      profileId: 'profile-vet-poppy',
      providerId: 'provider-vet-er',
      title: 'Emergency GI visit',
      eventType: 'urgent-care',
      reason: 'vomiting and GI distress',
      bodyPart: 'abdomen',
      startedAt: '2026-04-24T21:00:00.000Z',
      status: 'requested',
      expectedRecords: [
        { id: 'expected-vet-er-discharge', recordType: 'discharge note', status: 'requested', afterDays: 0 },
        { id: 'expected-vet-er-lab', recordType: 'lab report', status: 'pending', afterDays: 0 }
      ],
      attempts: [
        {
          id: 'attempt-vet-er-discharge-1',
          expectedRecordId: 'expected-vet-er-discharge',
          attemptNumber: 1,
          channel: 'email',
          kind: 'initial',
          sentAt: '2026-04-25T15:00:00.000Z',
          status: 'sent',
          body: 'Please send the discharge note for Poppy from the April 24 emergency visit.',
          nextFollowUpAt: '2026-04-27T15:00:00.000Z'
        }
      ]
    },
    {
      id: 'event-vet-dental',
      profileId: 'profile-vet-poppy',
      providerId: 'provider-vet-primary',
      title: 'Dental cleaning',
      eventType: 'procedure',
      reason: 'routine dental',
      bodyPart: 'teeth',
      startedAt: '2026-04-10T16:00:00.000Z',
      status: 'received',
      expectedRecords: [
        {
          id: 'expected-vet-dental-procedure',
          recordType: 'procedure note',
          status: 'received',
          afterDays: 0,
          document: {
            title: '2026-04-10_foothills-veterinary_procedure-note_dental.txt',
            vaultPath: 'profiles/pets/poppy-dog-001/documents/2026/2026-04-10_foothills-veterinary_procedure-note_dental.txt',
            content: 'Dental procedure note. Cleaning completed. Mild tartar removed. Recovery normal.'
          }
        },
        {
          id: 'expected-vet-dental-anesthesia',
          recordType: 'anesthesia note',
          status: 'received',
          afterDays: 0,
          document: {
            title: '2026-04-10_foothills-veterinary_anesthesia-note_dental.txt',
            vaultPath: 'profiles/pets/poppy-dog-001/documents/2026/2026-04-10_foothills-veterinary_anesthesia-note_dental.txt',
            content: 'Anesthesia note. No complications, monitored throughout.'
          }
        }
      ],
      attempts: []
    },
    {
      id: 'event-vet-wellness',
      profileId: 'profile-vet-poppy',
      providerId: 'provider-vet-primary',
      title: 'Annual wellness',
      eventType: 'wellness',
      reason: 'annual checkup',
      bodyPart: 'general',
      startedAt: '2026-03-27T17:00:00.000Z',
      status: 'partial',
      expectedRecords: [
        {
          id: 'expected-vet-wellness-vaccine',
          recordType: 'vaccine summary',
          status: 'received',
          afterDays: 0,
          document: {
            title: '2026-03-27_foothills-veterinary_vaccine-summary_wellness.txt',
            vaultPath: 'profiles/pets/poppy-dog-001/documents/2026/2026-03-27_foothills-veterinary_vaccine-summary_wellness.txt',
            content: 'Vaccine summary. Rabies and bordetella current.'
          }
        },
        { id: 'expected-vet-wellness-heartworm', recordType: 'heartworm result', status: 'requested', afterDays: 0 }
      ],
      attempts: [
        {
          id: 'attempt-vet-heartworm-1',
          expectedRecordId: 'expected-vet-wellness-heartworm',
          attemptNumber: 1,
          channel: 'portal',
          kind: 'initial',
          sentAt: '2026-03-28T15:00:00.000Z',
          status: 'sent',
          body: 'Please send the heartworm result from the annual wellness visit.',
          nextFollowUpAt: '2026-03-31T15:00:00.000Z'
        }
      ]
    }
  ];

  for (const event of seedEvents) {
    insertEvent.run(
      event.id,
      event.profileId,
      event.providerId,
      event.title,
      event.eventType,
      event.reason,
      event.bodyPart,
      event.startedAt,
      event.status,
      createdAt
    );

    for (const expected of event.expectedRecords) {
      insertExpected.run(
        expected.id,
        event.id,
        expected.recordType,
        expected.afterDays,
        expected.status,
        1,
        null,
        createdAt
      );

      if (expected.document) {
        const filePath = writeSeedDocument(expected.document.vaultPath, expected.document.content);
        const documentId = createDocumentRecord({
          profileId: event.profileId,
          providerId: event.providerId,
          sourceEventId: event.id,
          expectedRecordId: expected.id,
          title: expected.document.title,
          recordType: expected.recordType,
          documentDate: event.startedAt.slice(0, 10),
          sourcePathOriginal: filePath,
          vaultPathNormalized: filePath,
          mimeType: 'text/plain',
          ocrText: expected.document.content
        });

        insertTags(documentId, [
          ['record_type', expected.recordType],
          ['topic', event.reason],
          ['body_part', event.bodyPart],
          ['provider', providers.find((provider) => provider[0] === event.providerId)?.[2] ?? 'unknown']
        ]);

        db.prepare('UPDATE expected_records SET received_document_id = ? WHERE id = ?').run(documentId, expected.id);
      }
    }

    for (const attempt of event.attempts) {
      insertAttempt.run(
        attempt.id,
        attempt.expectedRecordId,
        attempt.attemptNumber,
        attempt.channel,
        attempt.kind,
        attempt.sentAt,
        attempt.status,
        attempt.body,
        attempt.nextFollowUpAt
      );
    }
  }

  const extraLabPath = writeSeedDocument(
    'profiles/humans/landon-001/documents/2026/2026-03-29_boulder-medical_lab-results_cbc.txt',
    'CBC results. Mild macrocytosis. Follow-up recommended.'
  );
  const extraLabId = createDocumentRecord({
    profileId: 'profile-human-landon',
    providerId: 'provider-ortho',
    title: '2026-03-29_boulder-medical_lab-results_cbc.txt',
    recordType: 'lab results',
    documentDate: '2026-03-29',
    sourcePathOriginal: extraLabPath,
    vaultPathNormalized: extraLabPath,
    mimeType: 'text/plain',
    ocrText: 'CBC results. Mild macrocytosis. Follow-up recommended.',
    status: 'review-needed'
  });

  insertTags(extraLabId, [
    ['record_type', 'lab results'],
    ['topic', 'fatigue'],
    ['provider', 'Boulder Medical']
  ]);

  insertAudit('human', 'Seeded baseline human records and request history.', { seeded: true });
  insertAudit('vet', 'Seeded baseline vet records and emergency packet history.', { seeded: true });
}

seedDatabase();

function listProviders(kind) {
  return db
    .prepare('SELECT id, name, provider_type AS providerType, specialty FROM providers WHERE kind = ? ORDER BY name')
    .all(kind);
}

function listProfiles(kind) {
  return db
    .prepare(
      'SELECT id, slug, display_name AS displayName, subtitle, species, breed FROM profiles WHERE kind = ? ORDER BY display_name'
    )
    .all(kind);
}

function getProfile(profileId) {
  return db
    .prepare(
      'SELECT id, kind, slug, display_name AS displayName, subtitle, species, breed FROM profiles WHERE id = ?'
    )
    .get(profileId);
}

function getPrimaryProfile(kind) {
  return db
    .prepare(
      'SELECT id, kind, slug, display_name AS displayName, subtitle, species, breed FROM profiles WHERE kind = ? ORDER BY created_at ASC LIMIT 1'
    )
    .get(kind);
}

function getProvider(providerId) {
  if (!providerId) {
    return null;
  }

  return db
    .prepare('SELECT id, kind, name, provider_type AS providerType, specialty FROM providers WHERE id = ?')
    .get(providerId);
}

function listEvents(kind, profileId) {
  const rows = db
    .prepare(
      `
        SELECT
          events.id,
          events.profile_id AS profileId,
          events.provider_id AS providerId,
          events.title,
          events.event_type AS eventType,
          events.reason,
          events.body_part AS bodyPart,
          events.started_at AS startedAt,
          events.status,
          providers.name AS providerName
        FROM events
        JOIN profiles ON profiles.id = events.profile_id
        JOIN providers ON providers.id = events.provider_id
        WHERE profiles.kind = ? AND events.profile_id = ?
        ORDER BY events.started_at DESC
      `
    )
    .all(kind, profileId);

  const expectedRows = db
    .prepare(
      `
        SELECT
          expected_records.id,
          expected_records.event_id AS eventId,
          expected_records.record_type AS recordType,
          expected_records.expected_after_days AS expectedAfterDays,
          expected_records.status,
          expected_records.received_document_id AS receivedDocumentId,
          COUNT(request_attempts.id) AS requestCount,
          MAX(request_attempts.sent_at) AS lastRequestedAt,
          MAX(request_attempts.next_follow_up_at) AS nextFollowUpAt
        FROM expected_records
        JOIN events ON events.id = expected_records.event_id
        JOIN profiles ON profiles.id = events.profile_id
        LEFT JOIN request_attempts ON request_attempts.expected_record_id = expected_records.id
        WHERE profiles.kind = ? AND events.profile_id = ?
        GROUP BY expected_records.id
        ORDER BY expected_records.created_at ASC
      `
    )
    .all(kind, profileId);

  return rows.map((event) => ({
    ...event,
    expectedRecords: expectedRows.filter((record) => record.eventId === event.id)
  }));
}

function listDocumentsRaw(kind, profileId) {
  const rows = db
    .prepare(
      `
        SELECT
          documents.id,
          documents.title,
          documents.record_type AS recordType,
          documents.document_date AS documentDate,
          documents.status,
          documents.ocr_text AS ocrText,
          documents.vault_path_normalized AS vaultPathFull,
          providers.name AS providerName
        FROM documents
        JOIN profiles ON profiles.id = documents.profile_id
        LEFT JOIN providers ON providers.id = documents.provider_id
        WHERE profiles.kind = ? AND documents.profile_id = ?
        ORDER BY documents.document_date DESC, documents.created_at DESC
      `
    )
    .all(kind, profileId);

  const tags = db
    .prepare(
      `
        SELECT document_id AS documentId, tag_type AS tagType, value
        FROM document_tags
        WHERE document_id IN (
          SELECT id FROM documents WHERE profile_id = ?
        )
      `
    )
    .all(profileId);

  return rows.map((document) => ({
    ...document,
    tags: tags
      .filter((tag) => tag.documentId === document.id)
      .map((tag) => `${tag.tagType.replace(/_/g, ' ')}: ${tag.value}`)
  }));
}

function listDocuments(kind, profileId) {
  return listDocumentsRaw(kind, profileId).map(({ vaultPathFull, ...document }) => ({
    ...document,
    vaultPath: relativePath(vaultPathFull)
  }));
}

function listAudit(kind) {
  return db
    .prepare(
      'SELECT id, message, created_at AS createdAt FROM audit_log WHERE kind = ? ORDER BY created_at DESC LIMIT 8'
    )
    .all(kind);
}

function listRequestBoard(kind, profileId) {
  return db
    .prepare(
      `
        SELECT
          expected_records.id,
          expected_records.record_type AS recordType,
          expected_records.status,
          events.title AS eventTitle,
          events.started_at AS startedAt,
          providers.name AS providerName,
          COUNT(request_attempts.id) AS requestCount,
          MAX(request_attempts.next_follow_up_at) AS nextFollowUpAt
        FROM expected_records
        JOIN events ON events.id = expected_records.event_id
        JOIN profiles ON profiles.id = events.profile_id
        JOIN providers ON providers.id = events.provider_id
        LEFT JOIN request_attempts ON request_attempts.expected_record_id = expected_records.id
        WHERE profiles.kind = ? AND profiles.id = ? AND expected_records.status != 'received'
        GROUP BY expected_records.id
        ORDER BY events.started_at DESC
      `
    )
    .all(kind, profileId);
}

function computeMetrics(events) {
  const expectedRecords = events.flatMap((event) => event.expectedRecords);
  const total = expectedRecords.length || 1;
  const progressed = expectedRecords.filter((record) => record.status !== 'pending').length;
  const open = expectedRecords.filter((record) => record.status !== 'received').length;

  return [
    {
      label: 'Coverage',
      value: `${Math.round((progressed / total) * 100)}%`,
      detail: 'tracked record outputs with at least one action or receipt'
    },
    {
      label: 'Open loops',
      value: `${open}`,
      detail: 'expected records still waiting on follow-up or delivery'
    },
    {
      label: 'Events',
      value: `${events.length}`,
      detail: 'tracked care events active in this local vault'
    }
  ];
}

function selectPacketDocuments(kind, profileId, presetKey) {
  const documents = listDocumentsRaw(kind, profileId);
  let selected = documents.slice(0, 4);

  if (presetKey === 'surgery-consult') {
    selected = documents.filter((document) =>
      ['imaging report', 'visit note', 'consult note', 'operative note'].includes(document.recordType)
    );
  } else if (presetKey === 'appeal-support') {
    selected = documents.filter((document) =>
      document.tags.some((tag) => tag.includes('topic')) || document.recordType.includes('lab')
    );
  } else if (presetKey === 'emergency-now') {
    selected = documents.filter((document) =>
      ['lab report', 'discharge note', 'medication list', 'procedure note'].includes(document.recordType)
    );
  } else if (presetKey === 'new-clinic') {
    selected = documents.slice(0, 5);
  } else if (presetKey === 'chronic-care') {
    selected = documents.filter((document) =>
      ['lab report', 'lab results', 'imaging report', 'consult note'].includes(document.recordType)
    );
  }

  if (selected.length === 0) {
    selected = documents.slice(0, 3);
  }

  return selected;
}

function buildPacketPreview(kind, profileId, presetKey) {
  const selected = selectPacketDocuments(kind, profileId, presetKey);

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

function exportPacketBundle(kind, profileId, presetKey) {
  const selected = selectPacketDocuments(kind, profileId, presetKey);
  const preview = buildPacketPreview(kind, profileId, presetKey);
  const profile = db
    .prepare('SELECT slug, display_name AS displayName FROM profiles WHERE id = ?')
    .get(profileId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const folderName = `${timestamp}_${slugify(profile.displayName)}_${slugify(presetKey)}`;
  const exportDir = join(packetOutputRoot, folderName);
  const documentsDir = join(exportDir, 'documents');
  const manifestPath = join(exportDir, 'manifest.json');
  const summaryPath = join(exportDir, 'summary.txt');

  mkdirSync(exportDir, { recursive: true });
  mkdirSync(documentsDir, { recursive: true });

  for (const [index, document] of selected.entries()) {
    const ext = extname(document.title) || '.bin';
    const exportName = `${String(index + 1).padStart(2, '0')}_${slugify(document.providerName || 'document')}_${slugify(document.recordType)}${ext}`;
    copyFileSync(document.vaultPathFull, join(documentsDir, exportName));
  }

  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        kind,
        profileId,
        profile: profile.displayName,
        presetKey,
        generatedAt: preview.generatedAt,
        count: preview.count,
        manifest: preview.manifest
      },
      null,
      2
    ),
    'utf8'
  );

  writeFileSync(
    summaryPath,
    [
      `Packet export: ${presetKey}`,
      `Profile: ${profile.displayName}`,
      `Generated: ${preview.generatedAt}`,
      `Document folder: documents/`,
      '',
      ...preview.manifest.map(
        (item) => `${item.line}. ${item.title} | ${item.providerName} | ${item.recordType} | ${item.documentDate}`
      )
    ].join('\n'),
    'utf8'
  );

  insertAudit(kind, `Generated packet export ${folderName}.`, {
    presetKey,
    exportDir: relativePath(exportDir)
  });

  return {
    ...preview,
    exportDir: relativePath(exportDir),
    files: [relativePath(manifestPath), relativePath(summaryPath), relativePath(documentsDir)]
  };
}

function getWatchFolders(kind) {
  const root = kind === 'human' ? inboundHuman : inboundVet;
  const pendingCount = countDirectFiles(root);

  return [
    {
      label: `${kind} inbound`,
      path: relativePath(root),
      pendingCount
    },
    {
      label: 'archive',
      path: relativePath(inboundArchive),
      pendingCount: countFiles(inboundArchive)
    },
    {
      label: 'vault',
      path: relativePath(vaultRoot),
      pendingCount: countFiles(vaultRoot)
    }
  ];
}

function bootstrapMode(kind) {
  const profiles = listProfiles(kind);
  const activeProfile = profiles[0];
  const events = activeProfile ? listEvents(kind, activeProfile.id) : [];
  const documents = activeProfile ? listDocuments(kind, activeProfile.id) : [];
  const requestBoard = activeProfile ? listRequestBoard(kind, activeProfile.id) : [];

  return {
    label: kind === 'human' ? 'Personal Health Record Vault' : 'Pet Health Vault',
    tagline:
      kind === 'human'
        ? 'Local-first continuity for fragmented medical histories.'
        : 'Local-first veterinary continuity with fast emergency packeting.',
    note:
      kind === 'human'
        ? 'Upload local files or scan inbound folders, then track every visit through request and receipt state.'
        : 'Upload local files or scan inbound folders, then keep each pet visit in a complete request loop.',
    profiles,
    providers: listProviders(kind),
    activeProfileId: activeProfile?.id ?? null,
    metrics: computeMetrics(events),
    events,
    documents,
    requestBoard,
    packetPresets: packetPresets[kind],
    watchFolders: getWatchFolders(kind),
    audit: listAudit(kind)
  };
}

function getBootstrapPayload() {
  return {
    generatedAt: nowIso(),
    modes: {
      human: bootstrapMode('human'),
      vet: bootstrapMode('vet')
    }
  };
}

function getExpectedRecord(expectedRecordId) {
  return db
    .prepare(
      `
        SELECT
          expected_records.id,
          expected_records.record_type AS recordType,
          expected_records.status,
          expected_records.event_id AS eventId,
          events.profile_id AS profileId,
          events.provider_id AS providerId,
          events.title AS eventTitle,
          profiles.kind
        FROM expected_records
        JOIN events ON events.id = expected_records.event_id
        JOIN profiles ON profiles.id = events.profile_id
        WHERE expected_records.id = ?
      `
    )
    .get(expectedRecordId);
}

function getEvent(eventId) {
  if (!eventId) {
    return null;
  }

  return db
    .prepare(
      `
        SELECT
          events.id,
          events.profile_id AS profileId,
          events.provider_id AS providerId,
          events.title,
          events.started_at AS startedAt,
          profiles.kind
        FROM events
        JOIN profiles ON profiles.id = events.profile_id
        WHERE events.id = ?
      `
    )
    .get(eventId);
}

function refreshEventStatus(eventId) {
  const statuses = db
    .prepare('SELECT status FROM expected_records WHERE event_id = ?')
    .all(eventId)
    .map((row) => row.status);

  if (statuses.length === 0) {
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('pending', eventId);
    return;
  }

  let nextStatus = 'pending';

  if (statuses.every((status) => status === 'received')) {
    nextStatus = 'received';
  } else if (statuses.some((status) => status === 'received')) {
    nextStatus = 'partial';
  } else if (statuses.some((status) => status === 'requested')) {
    nextStatus = 'requested';
  }

  db.prepare('UPDATE events SET status = ? WHERE id = ?').run(nextStatus, eventId);
}

function sendRequest(expectedRecordId, kind = 'initial', channel = 'portal') {
  const expected = getExpectedRecord(expectedRecordId);

  if (!expected) {
    throw new Error('Expected record not found.');
  }

  const attemptNumber =
    db.prepare('SELECT COALESCE(MAX(attempt_number), 0) AS value FROM request_attempts WHERE expected_record_id = ?')
      .get(expectedRecordId).value + 1;

  db.prepare(
    `
      INSERT INTO request_attempts (id, expected_record_id, attempt_number, channel, kind, sent_at, status, body_snapshot, next_follow_up_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    randomUUID(),
    expectedRecordId,
    attemptNumber,
    channel,
    kind,
    nowIso(),
    'sent',
    `Request ${expected.recordType} for ${expected.eventTitle}.`,
    plusDays(nowIso(), kind === 'follow-up' ? 2 : 3)
  );

  db.prepare('UPDATE expected_records SET status = ? WHERE id = ? AND status != ?').run(
    'requested',
    expectedRecordId,
    'received'
  );
  refreshEventStatus(expected.eventId);

  insertAudit(expected.kind, `${kind === 'follow-up' ? 'Follow-up sent' : 'Request sent'} for ${expected.recordType}.`, {
    expectedRecordId,
    channel
  });
}

function markExpectedRecordReceived(expectedRecordId, documentId = null) {
  const expected = getExpectedRecord(expectedRecordId);

  if (!expected) {
    throw new Error('Expected record not found.');
  }

  db.prepare('UPDATE expected_records SET status = ?, received_document_id = COALESCE(?, received_document_id) WHERE id = ?').run(
    'received',
    documentId,
    expectedRecordId
  );
  refreshEventStatus(expected.eventId);

  insertAudit(expected.kind, `Marked ${expected.recordType} as received.`, { expectedRecordId, documentId });
}

function createEvent(payload) {
  const createdAt = nowIso();
  const id = randomUUID();
  const expectedRecordTypes = (payload.expectedRecordTypes || [])
    .map((value) => value.trim())
    .filter(Boolean);

  db.prepare(
    `
      INSERT INTO events (id, profile_id, provider_id, title, event_type, reason, body_part, started_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    payload.profileId,
    payload.providerId,
    payload.title,
    payload.eventType,
    payload.reason || '',
    payload.bodyPart || '',
    payload.startedAt,
    'pending',
    createdAt
  );

  const insertExpected = db.prepare(
    'INSERT INTO expected_records (id, event_id, record_type, expected_after_days, status, required_for_completion, received_document_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  for (const recordType of expectedRecordTypes) {
    insertExpected.run(randomUUID(), id, recordType, 0, 'pending', 1, null, createdAt);
  }
  refreshEventStatus(id);

  const profile = db.prepare('SELECT kind FROM profiles WHERE id = ?').get(payload.profileId);
  insertAudit(profile.kind, `Created event ${payload.title}.`, { eventId: id });
}

async function importPhysicalFile({
  profileId,
  providerId = null,
  eventId = null,
  expectedRecordId = null,
  recordType,
  documentDate,
  originalFilename,
  sourcePath,
  mimeType,
  sourceLabel
}) {
  const profile = getProfile(profileId);

  if (!profile) {
    throw new Error('Profile not found.');
  }

  const provider = getProvider(providerId);
  const extension = extname(originalFilename) || '';
  const baseName = basename(originalFilename, extension) || 'document';
  const year = documentDate.slice(0, 4);
  const providerSlug = slugify(provider?.name ?? providerId ?? 'manual-import');
  const normalizedName = `${documentDate}_${providerSlug}_${slugify(recordType)}_${slugify(baseName)}${extension}`;
  const originalStoredPath = join(
    importOriginalRoot,
    `${Date.now()}_${slugify(baseName)}${extension}`
  );
  const vaultPath = join(
    vaultRoot,
    'profiles',
    profile.kind === 'human' ? 'humans' : 'pets',
    profile.slug,
    'documents',
    year,
    normalizedName
  );

  mkdirSync(dirname(originalStoredPath), { recursive: true });
  mkdirSync(dirname(vaultPath), { recursive: true });
  copyFileSync(sourcePath, originalStoredPath);
  copyFileSync(sourcePath, vaultPath);

  const extractedText = await extractSearchText(sourcePath, mimeType, originalFilename);
  const documentId = createDocumentRecord({
    profileId,
    providerId: provider?.id ?? null,
    sourceEventId: eventId,
    expectedRecordId,
    title: normalizedName,
    recordType,
    documentDate,
    sourcePathOriginal: originalStoredPath,
    vaultPathNormalized: vaultPath,
    mimeType,
    ocrText: extractedText,
    status: extractedText ? 'verified' : 'imported'
  });

  insertTags(documentId, [
    ['record_type', recordType],
    ['provider', provider?.name ?? 'unlinked'],
    ['source', sourceLabel]
  ]);

  if (expectedRecordId) {
    markExpectedRecordReceived(expectedRecordId, documentId);
  }

  insertAudit(profile.kind, `Imported ${normalizedName}.`, {
    documentId,
    sourceLabel,
    expectedRecordId
  });

  return {
    documentId,
    title: normalizedName,
    vaultPath: relativePath(vaultPath)
  };
}

async function importUploadedFiles(request) {
  const form = formidable({
    multiples: true,
    keepExtensions: true,
    allowEmptyFiles: false,
    maxFiles: 20
  });
  const [fields, files] = await form.parse(request);
  const profileId = firstValue(fields.profileId);
  const eventId = firstValue(fields.eventId) || null;
  const expectedRecordId = firstValue(fields.expectedRecordId) || null;
  const explicitRecordType = firstValue(fields.recordType) || 'imported document';
  const explicitDocumentDate = firstValue(fields.documentDate) || null;
  const event = getEvent(eventId);
  const expected = expectedRecordId ? getExpectedRecord(expectedRecordId) : null;
  const providerId = event?.providerId ?? (firstValue(fields.providerId) || null);
  const fileList = Array.isArray(files.documents)
    ? files.documents
    : files.documents
      ? [files.documents]
      : [];

  if (!profileId) {
    throw new Error('Profile is required for import.');
  }

  if (fileList.length === 0) {
    throw new Error('No files were uploaded.');
  }

  const imports = [];

  for (const [index, file] of fileList.entries()) {
    const stats = statSync(file.filepath);
    const documentDate =
      explicitDocumentDate ||
      event?.startedAt?.slice(0, 10) ||
      stats.mtime.toISOString().slice(0, 10);
    const result = await importPhysicalFile({
      profileId,
      providerId,
      eventId,
      expectedRecordId: index === 0 ? expected?.id ?? null : null,
      recordType: expected?.recordType ?? explicitRecordType,
      documentDate,
      originalFilename: file.originalFilename || `import-${index + 1}`,
      sourcePath: file.filepath,
      mimeType: file.mimetype || inferMimeType(file.originalFilename || ''),
      sourceLabel: 'uploaded-file'
    });

    imports.push(result);
  }

  return imports;
}

function createMockInboundRecord(payload) {
  const profile = db
    .prepare('SELECT id, kind, slug, display_name AS displayName FROM profiles WHERE id = ?')
    .get(payload.profileId);

  if (!profile) {
    throw new Error('Profile not found.');
  }

  const event = db
    .prepare('SELECT id, provider_id AS providerId, title, started_at AS startedAt FROM events WHERE id = ?')
    .get(payload.eventId);
  const expected = payload.expectedRecordId ? getExpectedRecord(payload.expectedRecordId) : null;
  const provider = db
    .prepare('SELECT id, name FROM providers WHERE id = ?')
    .get(event?.providerId ?? payload.providerId);
  const fileName = `${new Date().toISOString().slice(0, 10)}-${slugify(expected?.recordType ?? payload.recordType ?? 'record')}-${randomUUID().slice(0, 8)}.json`;
  const inboundPath = join(profile.kind === 'human' ? inboundHuman : inboundVet, fileName);
  const documentDate = event?.startedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const recordType = expected?.recordType ?? payload.recordType ?? 'visit note';

  writeFileSync(
    inboundPath,
    JSON.stringify(
      {
        profileId: profile.id,
        providerId: provider.id,
        eventId: event?.id ?? null,
        expectedRecordId: expected?.id ?? null,
        title:
          payload.title ??
          `${documentDate}_${slugify(provider.name)}_${slugify(recordType)}_${slugify(profile.displayName)}.txt`,
        recordType,
        documentDate,
        mimeType: 'text/plain',
        content:
          payload.content ??
          `${recordType} for ${profile.displayName}. Generated by the watched-folder mock for ${provider.name}.`
      },
      null,
      2
    ),
    'utf8'
  );

  insertAudit(profile.kind, `Queued mock inbound file ${fileName}.`, { inboundPath: relativePath(inboundPath) });
  return inboundPath;
}

async function ingestLegacyMockFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  const result = await importPhysicalFile({
    profileId: payload.profileId,
    providerId: payload.providerId,
    eventId: payload.eventId ?? null,
    expectedRecordId: payload.expectedRecordId ?? null,
    recordType: payload.recordType,
    documentDate: payload.documentDate,
    originalFilename: payload.title,
    sourcePath: filePath,
    mimeType: payload.mimeType || 'text/plain',
    sourceLabel: 'watched-folder-mock'
  });
  const archivedPath = join(inboundArchive, `${Date.now()}-${slugify(payload.title)}.json`);
  renameSync(filePath, archivedPath);
  return {
    ...result,
    archivedPath: relativePath(archivedPath)
  };
}

async function ingestRawInboundFile(filePath, kind) {
  const profile = getPrimaryProfile(kind);

  if (!profile) {
    throw new Error(`No ${kind} profile is available for inbound file ${filePath}.`);
  }

  const stats = statSync(filePath);
  const result = await importPhysicalFile({
    profileId: profile.id,
    recordType: 'imported document',
    documentDate: stats.mtime.toISOString().slice(0, 10),
    originalFilename: basename(filePath),
    sourcePath: filePath,
    mimeType: inferMimeType(filePath),
    sourceLabel: 'watched-folder'
  });
  const archivedPath = join(inboundArchive, `${Date.now()}-${basename(filePath)}`);
  renameSync(filePath, archivedPath);
  return {
    ...result,
    archivedPath: relativePath(archivedPath)
  };
}

async function scanInbound() {
  const inboundFiles = [
    ...readdirSync(inboundHuman).map((entry) => ({ filePath: join(inboundHuman, entry), kind: 'human' })),
    ...readdirSync(inboundVet).map((entry) => ({ filePath: join(inboundVet, entry), kind: 'vet' }))
  ].filter(({ filePath }) => statSync(filePath).isFile());

  let ingested = 0;

  for (const { filePath, kind } of inboundFiles) {
    try {
      if (filePath.endsWith('.json')) {
        await ingestLegacyMockFile(filePath);
      } else {
        await ingestRawInboundFile(filePath, kind);
      }
      ingested += 1;
    } catch (error) {
      console.error(`Failed to ingest ${filePath}`, error);
    }
  }

  return ingested;
}

setInterval(() => {
  void scanInbound();
}, scanIntervalMs).unref();

function packetPreview(kind, profileId, presetKey) {
  return buildPacketPreview(kind, profileId, presetKey);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function serveStatic(urlPath, response) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = resolve(publicRoot, `.${cleanPath}`);
  const allowed = filePath.startsWith(publicRoot);

  if (!allowed) {
    sendText(response, 403, 'Forbidden');
    return true;
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const contentType = filePath.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : filePath.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : filePath.endsWith('.js')
          ? 'application/javascript; charset=utf-8'
          : 'application/octet-stream';

    sendText(response, 200, readFileSync(filePath), contentType);
    return true;
  }

  const indexPath = join(publicRoot, 'index.html');

  if (existsSync(indexPath)) {
    sendText(response, 200, readFileSync(indexPath), 'text/html; charset=utf-8');
    return true;
  }

  return false;
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing URL' });
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    response.end();
    return;
  }

  try {
    if (url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        port,
        dbPath: relativePath(dbPath),
        scanIntervalMs
      });
      return;
    }

    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      sendJson(response, 200, getBootstrapPayload());
      return;
    }

    if (url.pathname === '/api/import' && request.method === 'POST') {
      const imported = await importUploadedFiles(request);
      sendJson(response, 200, { ok: true, imported });
      return;
    }

    if (url.pathname === '/api/events' && request.method === 'POST') {
      const payload = await readJsonBody(request);
      createEvent(payload);
      sendJson(response, 201, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/expected-records/') && url.pathname.endsWith('/request') && request.method === 'POST') {
      const expectedRecordId = url.pathname.split('/')[3];
      const payload = await readJsonBody(request);
      sendRequest(expectedRecordId, 'initial', payload.channel || 'portal');
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/expected-records/') && url.pathname.endsWith('/follow-up') && request.method === 'POST') {
      const expectedRecordId = url.pathname.split('/')[3];
      const payload = await readJsonBody(request);
      sendRequest(expectedRecordId, 'follow-up', payload.channel || 'portal');
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/expected-records/') && url.pathname.endsWith('/receive') && request.method === 'POST') {
      const expectedRecordId = url.pathname.split('/')[3];
      markExpectedRecordReceived(expectedRecordId);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/mock-ingest' && request.method === 'POST') {
      const payload = await readJsonBody(request);
      const inboundPath = createMockInboundRecord(payload);
      const ingested = await scanInbound();
      sendJson(response, 200, {
        ok: true,
        inboundPath: relativePath(inboundPath),
        ingested
      });
      return;
    }

    if (url.pathname === '/api/watcher/scan' && request.method === 'POST') {
      const ingested = await scanInbound();
      sendJson(response, 200, { ok: true, ingested });
      return;
    }

    if (url.pathname === '/api/packets/preview' && request.method === 'POST') {
      const payload = await readJsonBody(request);
      sendJson(response, 200, packetPreview(payload.kind, payload.profileId, payload.presetKey));
      return;
    }

    if (url.pathname === '/api/packets/export' && request.method === 'POST') {
      const payload = await readJsonBody(request);
      sendJson(response, 200, exportPacketBundle(payload.kind, payload.profileId, payload.presetKey));
      return;
    }

    if (serveStatic(url.pathname, response)) {
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unknown server error'
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Health Records app shell listening on http://127.0.0.1:${port}`);
});
