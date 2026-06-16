// Demo data for the browser-only Vercel deployment.
// Everything here is FICTIONAL. No real PHI. The shape mirrors exactly what
// `server/index.mjs` returns from `GET /api/bootstrap` so the UI renders unchanged.

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

// ----- Human persona: Riley Demo -----
const humanProfile = {
  id: 'profile-human-riley',
  slug: 'riley-demo-001',
  displayName: 'Riley Demo',
  subtitle: 'multi-specialist demo patient',
  species: null,
  breed: null
};

const humanProviders = [
  { id: 'provider-pcp', name: 'Maplewood Family Medicine', providerType: 'clinic', specialty: 'Primary care' },
  { id: 'provider-imaging', name: 'Crestline Imaging Center', providerType: 'imaging', specialty: 'Radiology' },
  { id: 'provider-cardio', name: 'Harbor Cardiology Associates', providerType: 'specialist', specialty: 'Cardiology' },
  { id: 'provider-derm', name: 'Northgate Dermatology', providerType: 'specialist', specialty: 'Dermatology' },
  { id: 'provider-pharmacy', name: 'Riverside Pharmacy', providerType: 'pharmacy', specialty: 'Pharmacy' }
];

// ----- Pet persona: Mochi (cat) -----
const vetProfile = {
  id: 'profile-vet-mochi',
  slug: 'mochi-cat-001',
  displayName: 'Mochi',
  subtitle: 'household demo profile',
  species: 'Cat',
  breed: 'Domestic Shorthair'
};

const vetProviders = [
  { id: 'provider-vet-primary', name: 'Willowbrook Animal Clinic', providerType: 'clinic', specialty: 'Primary care' },
  { id: 'provider-vet-er', name: 'Cityline Pet Emergency', providerType: 'emergency', specialty: 'Emergency' },
  { id: 'provider-vet-derm', name: 'Paws & Skin Veterinary Dermatology', providerType: 'specialist', specialty: 'Dermatology' }
];

// Human events with expected records in various states.
const humanEvents = [
  {
    id: 'event-human-annual',
    profileId: humanProfile.id,
    providerId: 'provider-pcp',
    title: 'Annual physical',
    eventType: 'visit',
    reason: 'routine wellness exam',
    bodyPart: 'general',
    startedAt: '2026-05-12T16:00:00.000Z',
    providerName: 'Maplewood Family Medicine',
    status: 'received',
    expectedRecords: [
      {
        id: 'er-human-avs',
        recordType: 'after-visit summary',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-05-12T18:00:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-05-12_maplewood-family-medicine_after-visit-summary_annual.txt',
          recordType: 'after-visit summary',
          providerName: 'Maplewood Family Medicine',
          documentDate: '2026-05-12',
          ocrText:
            'After-visit summary. Annual physical. BP 122/78. Continue lisinopril 10mg daily. Discussed diet and exercise. Routine labs ordered.',
          tags: ['record type: after-visit summary', 'topic: wellness', 'provider: Maplewood Family Medicine']
        }
      }
    ]
  },
  {
    id: 'event-human-labs',
    profileId: humanProfile.id,
    providerId: 'provider-pcp',
    title: 'Comprehensive lab panel',
    eventType: 'lab',
    reason: 'annual screening labs',
    bodyPart: 'general',
    startedAt: '2026-05-13T14:30:00.000Z',
    providerName: 'Maplewood Family Medicine',
    status: 'received',
    expectedRecords: [
      {
        id: 'er-human-cmp',
        recordType: 'lab panel',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-05-14T15:00:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-05-13_maplewood-family-medicine_lab-panel_cmp-lipids.txt',
          recordType: 'lab panel',
          providerName: 'Maplewood Family Medicine',
          documentDate: '2026-05-13',
          ocrText:
            'Comprehensive metabolic panel and lipid panel. Glucose 96 mg/dL. LDL 138 mg/dL (slightly elevated). A1c 5.6%. eGFR normal. Recommend lipid recheck in 3 months.',
          tags: ['record type: lab panel', 'topic: screening', 'provider: Maplewood Family Medicine']
        }
      }
    ]
  },
  {
    id: 'event-human-echo',
    profileId: humanProfile.id,
    providerId: 'provider-cardio',
    title: 'Cardiology consult & echocardiogram',
    eventType: 'imaging',
    reason: 'palpitations workup',
    bodyPart: 'heart',
    startedAt: '2026-05-20T17:15:00.000Z',
    providerName: 'Harbor Cardiology Associates',
    status: 'partial',
    expectedRecords: [
      {
        id: 'er-human-echo-report',
        recordType: 'imaging report',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-05-21T16:00:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-05-20_harbor-cardiology-associates_imaging-report_echocardiogram.txt',
          recordType: 'imaging report',
          providerName: 'Harbor Cardiology Associates',
          documentDate: '2026-05-20',
          ocrText:
            'Transthoracic echocardiogram. Ejection fraction 60% (normal). No significant valvular disease. Trace mitral regurgitation. No structural cause for palpitations identified.',
          tags: ['record type: imaging report', 'topic: palpitations', 'body part: heart', 'provider: Harbor Cardiology Associates']
        }
      },
      {
        id: 'er-human-echo-consult',
        recordType: 'consult note',
        status: 'requested',
        requestCount: 2,
        lastRequestedAt: '2026-06-02T15:00:00.000Z',
        nextFollowUpAt: '2026-06-09T15:00:00.000Z',
        document: null
      }
    ]
  },
  {
    id: 'event-human-derm',
    profileId: humanProfile.id,
    providerId: 'provider-derm',
    title: 'Dermatology biopsy follow-up',
    eventType: 'procedure',
    reason: 'suspicious mole removal',
    bodyPart: 'left shoulder',
    startedAt: '2026-05-28T15:45:00.000Z',
    providerName: 'Northgate Dermatology',
    status: 'requested',
    expectedRecords: [
      {
        id: 'er-human-path',
        recordType: 'referral',
        status: 'requested',
        requestCount: 1,
        lastRequestedAt: '2026-06-01T14:00:00.000Z',
        nextFollowUpAt: '2026-06-08T14:00:00.000Z',
        document: null
      },
      {
        id: 'er-human-derm-note',
        recordType: 'pathology report',
        status: 'pending',
        requestCount: 0,
        lastRequestedAt: null,
        nextFollowUpAt: null,
        document: null
      }
    ]
  },
  {
    id: 'event-human-immun',
    profileId: humanProfile.id,
    providerId: 'provider-pcp',
    title: 'Travel immunizations',
    eventType: 'visit',
    reason: 'pre-travel vaccinations',
    bodyPart: 'general',
    startedAt: '2026-04-30T18:00:00.000Z',
    providerName: 'Maplewood Family Medicine',
    status: 'received',
    expectedRecords: [
      {
        id: 'er-human-immun',
        recordType: 'immunization record',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-05-01T16:00:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-04-30_maplewood-family-medicine_immunization-record_travel.txt',
          recordType: 'immunization record',
          providerName: 'Maplewood Family Medicine',
          documentDate: '2026-04-30',
          ocrText:
            'Immunization record. Administered: Hepatitis A (1st dose), Typhoid (oral), Tdap booster. Next Hepatitis A dose due in 6 months.',
          tags: ['record type: immunization record', 'topic: travel', 'provider: Maplewood Family Medicine']
        }
      }
    ]
  },
  {
    id: 'event-human-rx',
    profileId: humanProfile.id,
    providerId: 'provider-pharmacy',
    title: 'Prescription refill — lisinopril',
    eventType: 'visit',
    reason: 'blood pressure maintenance',
    bodyPart: 'general',
    startedAt: '2026-06-03T19:00:00.000Z',
    providerName: 'Riverside Pharmacy',
    status: 'received',
    expectedRecords: [
      {
        id: 'er-human-rx',
        recordType: 'prescription',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-06-03T19:30:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-06-03_riverside-pharmacy_prescription_lisinopril.txt',
          recordType: 'prescription',
          providerName: 'Riverside Pharmacy',
          documentDate: '2026-06-03',
          ocrText:
            'Prescription. Lisinopril 10 mg, one tablet by mouth daily. Quantity 90. Refills: 3. Prescriber: Maplewood Family Medicine.',
          tags: ['record type: prescription', 'topic: hypertension', 'provider: Riverside Pharmacy']
        }
      }
    ]
  }
];

// Pet events.
const vetEvents = [
  {
    id: 'event-vet-wellness',
    profileId: vetProfile.id,
    providerId: 'provider-vet-primary',
    title: 'Annual wellness exam',
    eventType: 'wellness',
    reason: 'routine checkup and vaccines',
    bodyPart: 'general',
    startedAt: '2026-04-15T17:00:00.000Z',
    providerName: 'Willowbrook Animal Clinic',
    status: 'received',
    expectedRecords: [
      {
        id: 'er-vet-vaccine',
        recordType: 'vaccine summary',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-04-16T15:00:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-04-15_willowbrook-animal-clinic_vaccine-summary_wellness.txt',
          recordType: 'vaccine summary',
          providerName: 'Willowbrook Animal Clinic',
          documentDate: '2026-04-15',
          ocrText:
            'Vaccine summary for Mochi. FVRCP booster administered, current. Rabies (3-year) current through 2029. Weight 4.6 kg, healthy body condition.',
          tags: ['record type: vaccine summary', 'topic: wellness', 'provider: Willowbrook Animal Clinic']
        }
      }
    ]
  },
  {
    id: 'event-vet-er',
    profileId: vetProfile.id,
    providerId: 'provider-vet-er',
    title: 'Emergency urinary blockage',
    eventType: 'urgent-care',
    reason: 'straining to urinate',
    bodyPart: 'urinary tract',
    startedAt: '2026-05-22T22:30:00.000Z',
    providerName: 'Cityline Pet Emergency',
    status: 'partial',
    expectedRecords: [
      {
        id: 'er-vet-discharge',
        recordType: 'discharge note',
        status: 'received',
        requestCount: 1,
        lastRequestedAt: '2026-05-23T16:00:00.000Z',
        nextFollowUpAt: null,
        document: {
          title: '2026-05-22_cityline-pet-emergency_discharge-note_urinary.txt',
          recordType: 'discharge note',
          providerName: 'Cityline Pet Emergency',
          documentDate: '2026-05-22',
          ocrText:
            'Discharge note for Mochi. Treated for feline urethral obstruction. Urinary catheter placed and removed. Discharged on prazosin and prescription urinary diet. Recheck in 7 days.',
          tags: ['record type: discharge note', 'topic: urinary obstruction', 'body part: urinary tract', 'provider: Cityline Pet Emergency']
        }
      },
      {
        id: 'er-vet-lab',
        recordType: 'lab report',
        status: 'requested',
        requestCount: 2,
        lastRequestedAt: '2026-05-30T15:00:00.000Z',
        nextFollowUpAt: '2026-06-06T15:00:00.000Z',
        document: null
      }
    ]
  },
  {
    id: 'event-vet-derm',
    profileId: vetProfile.id,
    providerId: 'provider-vet-derm',
    title: 'Dermatology recheck',
    eventType: 'procedure',
    reason: 'chronic ear and skin irritation',
    bodyPart: 'skin',
    startedAt: '2026-06-04T16:30:00.000Z',
    providerName: 'Paws & Skin Veterinary Dermatology',
    status: 'requested',
    expectedRecords: [
      {
        id: 'er-vet-derm-note',
        recordType: 'procedure note',
        status: 'requested',
        requestCount: 1,
        lastRequestedAt: '2026-06-05T14:00:00.000Z',
        nextFollowUpAt: '2026-06-12T14:00:00.000Z',
        document: null
      },
      {
        id: 'er-vet-derm-cyto',
        recordType: 'lab report',
        status: 'pending',
        requestCount: 0,
        lastRequestedAt: null,
        nextFollowUpAt: null,
        document: null
      }
    ]
  }
];

const humanAudit = [
  { id: 'audit-h-1', message: 'Marked prescription as received.', createdAt: '2026-06-03T19:30:00.000Z' },
  { id: 'audit-h-2', message: 'Follow-up sent for consult note.', createdAt: '2026-06-02T15:00:00.000Z' },
  { id: 'audit-h-3', message: 'Request sent for referral.', createdAt: '2026-06-01T14:00:00.000Z' },
  { id: 'audit-h-4', message: 'Imported echocardiogram imaging report.', createdAt: '2026-05-21T16:00:00.000Z' },
  { id: 'audit-h-5', message: 'Seeded demo human records and request history.', createdAt: '2026-05-12T16:00:00.000Z' }
];

const vetAudit = [
  { id: 'audit-v-1', message: 'Follow-up sent for lab report.', createdAt: '2026-06-05T14:00:00.000Z' },
  { id: 'audit-v-2', message: 'Request sent for procedure note.', createdAt: '2026-06-05T14:00:00.000Z' },
  { id: 'audit-v-3', message: 'Marked discharge note as received.', createdAt: '2026-05-23T16:00:00.000Z' },
  { id: 'audit-v-4', message: 'Seeded demo vet records and emergency packet history.', createdAt: '2026-04-15T17:00:00.000Z' }
];

const watchFolders = {
  human: [
    { label: 'human inbound', path: 'runtime/inbound/human', pendingCount: 0 },
    { label: 'archive', path: 'runtime/inbound/archive', pendingCount: 12 },
    { label: 'vault', path: 'runtime/vault', pendingCount: 5 }
  ],
  vet: [
    { label: 'vet inbound', path: 'runtime/inbound/vet', pendingCount: 0 },
    { label: 'archive', path: 'runtime/inbound/archive', pendingCount: 12 },
    { label: 'vault', path: 'runtime/vault', pendingCount: 2 }
  ]
};

function nowIso() {
  return new Date().toISOString();
}

// Mirror server computeMetrics().
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

// Mirror server listDocuments(): one document per received expected record.
function buildDocuments(profileSlug, kind, events) {
  const folder = kind === 'human' ? 'humans' : 'pets';
  const documents = [];

  for (const event of events) {
    for (const record of event.expectedRecords) {
      if (record.status === 'received' && record.document) {
        const doc = record.document;
        const year = doc.documentDate.slice(0, 4);
        documents.push({
          id: `doc-${record.id}`,
          title: doc.title,
          recordType: doc.recordType,
          documentDate: doc.documentDate,
          status: 'verified',
          ocrText: doc.ocrText,
          providerName: doc.providerName,
          vaultPath: `runtime/vault/profiles/${folder}/${profileSlug}/documents/${year}/${doc.title}`,
          tags: doc.tags
        });
      }
    }
  }

  return documents.sort((a, b) => (a.documentDate < b.documentDate ? 1 : -1));
}

// Mirror server listRequestBoard(): open expected records (status != received).
function buildRequestBoard(events) {
  const board = [];

  for (const event of events) {
    for (const record of event.expectedRecords) {
      if (record.status !== 'received') {
        board.push({
          id: record.id,
          recordType: record.recordType,
          status: record.status,
          eventTitle: event.title,
          startedAt: event.startedAt,
          providerName: event.providerName,
          requestCount: record.requestCount,
          nextFollowUpAt: record.nextFollowUpAt
        });
      }
    }
  }

  return board.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

// Strip internal `document` field from expected records for the events array
// (the server's events query exposes receivedDocumentId, not the doc payload).
function publicEvents(events) {
  return events.map((event) => ({
    id: event.id,
    profileId: event.profileId,
    providerId: event.providerId,
    title: event.title,
    eventType: event.eventType,
    reason: event.reason,
    bodyPart: event.bodyPart,
    startedAt: event.startedAt,
    status: event.status,
    providerName: event.providerName,
    expectedRecords: event.expectedRecords.map((record) => ({
      id: record.id,
      eventId: event.id,
      recordType: record.recordType,
      expectedAfterDays: 0,
      status: record.status,
      receivedDocumentId: record.status === 'received' && record.document ? `doc-${record.id}` : null,
      requestCount: record.requestCount,
      lastRequestedAt: record.lastRequestedAt,
      nextFollowUpAt: record.nextFollowUpAt
    }))
  }));
}

function buildMode(kind) {
  const profile = kind === 'human' ? humanProfile : vetProfile;
  const providers = kind === 'human' ? humanProviders : vetProviders;
  const events = kind === 'human' ? humanEvents : vetEvents;
  const audit = kind === 'human' ? humanAudit : vetAudit;

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
    profiles: [profile],
    providers,
    activeProfileId: profile.id,
    metrics: computeMetrics(events),
    events: publicEvents(events),
    documents: buildDocuments(profile.slug, kind, events),
    requestBoard: buildRequestBoard(events),
    packetPresets: packetPresets[kind],
    watchFolders: watchFolders[kind],
    audit
  };
}

// Build the full bootstrap payload, exactly matching the server response shape.
export function buildBootstrap() {
  return {
    generatedAt: nowIso(),
    modes: {
      human: buildMode('human'),
      vet: buildMode('vet')
    }
  };
}

export { packetPresets, computeMetrics };
