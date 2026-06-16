import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { handleDemoRequest, addExtractedDocument, getKindForProfile } from './demo/demoStore.js';

const DEMO_MODE = import.meta.env.VITE_DEMO === 'true';

const modeCopy = {
  human: {
    eyebrow: 'Human product',
    title: 'Personal Health Record Vault',
    tagline: 'Own your records. Keep them local. Move every visit into a complete record loop.'
  },
  vet: {
    eyebrow: 'Vet pilot',
    title: 'Pet Health Vault',
    tagline: 'Never lose a vet record again. Emergency transfer should be a two-minute task.'
  }
};

const eventTypeOptions = {
  human: [
    ['visit', 'Visit'],
    ['imaging', 'Imaging'],
    ['lab', 'Lab'],
    ['procedure', 'Procedure'],
    ['discharge', 'Discharge']
  ],
  vet: [
    ['wellness', 'Wellness'],
    ['urgent-care', 'Urgent care'],
    ['procedure', 'Procedure'],
    ['lab', 'Lab'],
    ['vaccination', 'Vaccination']
  ]
};

const defaultExpectedRecords = {
  human: 'visit note, after-visit summary',
  vet: 'visit note, discharge note'
};

const statusLabels = {
  pending: 'Pending',
  requested: 'Requested',
  received: 'Received',
  partial: 'Partial',
  complete: 'Complete',
  queued: 'Queued',
  'in-progress': 'In progress'
};

function todayLocal() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function todayDate() {
  return todayLocal().slice(0, 10);
}

function makeDraft(kind) {
  return {
    title: '',
    eventType: eventTypeOptions[kind][0][0],
    reason: '',
    bodyPart: '',
    startedAt: todayLocal(),
    providerId: '',
    expectedRecords: defaultExpectedRecords[kind]
  };
}

function makeImportDraft(kind) {
  return {
    eventId: '',
    expectedRecordId: '',
    providerId: '',
    recordType: kind === 'human' ? 'visit note' : 'visit note',
    documentDate: todayDate(),
    files: []
  };
}

function formatDate(value) {
  if (!value) {
    return 'Unscheduled';
  }

  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function request(path, options = {}) {
  // In demo mode, the prototype's own /api/* endpoints resolve against an
  // in-memory store instead of hitting the network. AI endpoints (/api/ai/*)
  // are real Vercel serverless functions, so they still go over the wire.
  if (DEMO_MODE && path.startsWith('/api/') && !path.startsWith('/api/ai/')) {
    return handleDemoRequest(path, options);
  }

  const headers = new Headers(options.headers || {});

  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

export default function App() {
  const [mode, setMode] = useState('human');
  const [data, setData] = useState(null);
  const [busyKey, setBusyKey] = useState('');
  const [flash, setFlash] = useState('');
  const [query, setQuery] = useState('');
  const [packetPreset, setPacketPreset] = useState({ human: '', vet: '' });
  const [packetPreview, setPacketPreview] = useState({ human: null, vet: null });
  const [packetExport, setPacketExport] = useState({ human: null, vet: null });
  const [drafts, setDrafts] = useState({
    human: makeDraft('human'),
    vet: makeDraft('vet')
  });
  const [importDrafts, setImportDrafts] = useState({
    human: makeImportDraft('human'),
    vet: makeImportDraft('vet')
  });
  const importInputRef = useRef(null);

  // --- AI feature state ---
  const [aiSummary, setAiSummary] = useState({ human: null, vet: null });
  const [aiBusy, setAiBusy] = useState('');
  const [aiError, setAiError] = useState('');
  const [extractText, setExtractText] = useState('');
  const [extractResult, setExtractResult] = useState(null);
  const [letter, setLetter] = useState({ text: '', recordType: '' });
  const [copied, setCopied] = useState(false);

  // --- Chat widget state ---
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatThreads, setChatThreads] = useState({ human: [], vet: [] });
  const chatScrollRef = useRef(null);

  const deferredQuery = useDeferredValue(query);
  const modeData = data?.modes?.[mode] ?? null;
  const activeProfile = modeData?.profiles?.[0] ?? null;
  const copy = modeCopy[mode];
  const importDraft = importDrafts[mode];
  const selectedImportEvent = modeData?.events?.find((event) => event.id === importDraft.eventId) ?? null;
  const selectedImportProviderId = importDraft.providerId || modeData?.providers?.[0]?.id || '';
  const openExpectedRecords = selectedImportEvent
    ? selectedImportEvent.expectedRecords.filter((record) => record.status !== 'received')
    : [];
  const filteredDocuments = (modeData?.documents ?? []).filter((document) => {
    const q = deferredQuery.trim().toLowerCase();

    if (!q) {
      return true;
    }

    return `${document.title} ${document.providerName} ${document.recordType} ${document.tags.join(' ')}`
      .toLowerCase()
      .includes(q);
  });

  async function loadBootstrap(silent = false) {
    const payload = await request('/api/bootstrap');

    startTransition(() => {
      setData(payload);
      setDrafts((current) => {
        const next = { ...current };

        for (const currentMode of ['human', 'vet']) {
          const firstProvider = payload.modes[currentMode]?.providers?.[0]?.id ?? '';

          next[currentMode] = {
            ...current[currentMode],
            providerId: current[currentMode].providerId || firstProvider
          };
        }

        return next;
      });
      setImportDrafts((current) => {
        const next = { ...current };

        for (const currentMode of ['human', 'vet']) {
          const firstProvider = payload.modes[currentMode]?.providers?.[0]?.id ?? '';

          next[currentMode] = {
            ...current[currentMode],
            providerId: current[currentMode].providerId || firstProvider
          };
        }

        return next;
      });
      setPacketPreset((current) => ({
        human: current.human || payload.modes.human.packetPresets[0]?.key || '',
        vet: current.vet || payload.modes.vet.packetPresets[0]?.key || ''
      }));
    });

    if (!silent) {
      setFlash('');
    }
  }

  useEffect(() => {
    loadBootstrap().catch((error) => setFlash(error.message));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      request('/api/bootstrap')
        .then((payload) => {
          startTransition(() => {
            setData(payload);
          });
        })
        .catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!modeData || !activeProfile) {
      return;
    }

    const currentPreset = packetPreset[mode] || modeData.packetPresets[0]?.key;

    if (!currentPreset) {
      return;
    }

    request('/api/packets/preview', {
      method: 'POST',
      body: JSON.stringify({
        kind: mode,
        profileId: activeProfile.id,
        presetKey: currentPreset
      })
    })
      .then((preview) => {
        setPacketPreview((current) => ({
          ...current,
          [mode]: preview
        }));
      })
      .catch((error) => setFlash(error.message));
  }, [mode, modeData, activeProfile, packetPreset]);

  async function runAction(key, action, successMessage) {
    try {
      setBusyKey(key);
      await action();
      await loadBootstrap(true);
      if (successMessage) {
        setFlash(successMessage);
      }
    } catch (error) {
      setFlash(error.message);
    } finally {
      setBusyKey('');
    }
  }

  async function submitEvent(event) {
    event.preventDefault();

    if (!activeProfile) {
      return;
    }

    const draft = drafts[mode];

    await runAction(
      'create-event',
      () =>
        request('/api/events', {
          method: 'POST',
          body: JSON.stringify({
            profileId: activeProfile.id,
            providerId: draft.providerId,
            title: draft.title,
            eventType: draft.eventType,
            reason: draft.reason,
            bodyPart: draft.bodyPart,
            startedAt: new Date(draft.startedAt).toISOString(),
            expectedRecordTypes: draft.expectedRecords.split(',')
          })
        }),
      'Event created and added to the request workflow.'
    );

    setDrafts((current) => ({
      ...current,
      [mode]: {
        ...makeDraft(mode),
        providerId: draft.providerId
      }
    }));
  }

  function updateDraft(field, value) {
    setDrafts((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        [field]: value
      }
    }));
  }

  function updateImportDraft(field, value) {
    setImportDrafts((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        [field]: value
      }
    }));
  }

  function updateImportEvent(eventId) {
    const nextEvent = modeData?.events?.find((event) => event.id === eventId) ?? null;
    const nextExpectedRecordId =
      nextEvent?.expectedRecords.find((record) => record.status !== 'received')?.id ?? '';

    setImportDrafts((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        eventId,
        expectedRecordId: eventId ? nextExpectedRecordId : '',
        providerId: nextEvent?.providerId ?? current[mode].providerId
      }
    }));
  }

  function updateImportFiles(files) {
    setImportDrafts((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        files: Array.from(files || [])
      }
    }));
  }

  async function requestRecord(expectedRecordId) {
    await runAction(
      `request-${expectedRecordId}`,
      () =>
        request(`/api/expected-records/${expectedRecordId}/request`, {
          method: 'POST',
          body: JSON.stringify({ channel: 'portal' })
        }),
      'Request logged.'
    );
  }

  async function followUpRecord(expectedRecordId) {
    await runAction(
      `followup-${expectedRecordId}`,
      () =>
        request(`/api/expected-records/${expectedRecordId}/follow-up`, {
          method: 'POST',
          body: JSON.stringify({ channel: 'email' })
        }),
      'Follow-up logged.'
    );
  }

  async function markReceived(expectedRecordId) {
    await runAction(
      `receive-${expectedRecordId}`,
      () =>
        request(`/api/expected-records/${expectedRecordId}/receive`, {
          method: 'POST'
        }),
      'Record marked received.'
    );
  }

  async function runWatcherScan() {
    await runAction(
      'scan-now',
      () =>
        request('/api/watcher/scan', {
          method: 'POST'
        }),
      'Inbound folder scan finished.'
    );
  }

  async function importDocuments(event) {
    event.preventDefault();

    if (!activeProfile) {
      return;
    }

    if (importDraft.files.length === 0) {
      setFlash('Choose at least one file to import.');
      return;
    }

    await runAction(
      `import-${mode}`,
      async () => {
        const formData = new FormData();

        formData.append('profileId', activeProfile.id);
        formData.append('providerId', selectedImportProviderId);
        formData.append('recordType', importDraft.recordType);
        formData.append('documentDate', importDraft.documentDate || todayDate());

        if (importDraft.eventId) {
          formData.append('eventId', importDraft.eventId);
        }

        if (importDraft.expectedRecordId) {
          formData.append('expectedRecordId', importDraft.expectedRecordId);
        }

        for (const file of importDraft.files) {
          formData.append('documents', file);
        }

        await request('/api/import', {
          method: 'POST',
          body: formData
        });

        setImportDrafts((current) => ({
          ...current,
          [mode]: {
            ...current[mode],
            expectedRecordId: '',
            documentDate: todayDate(),
            files: []
          }
        }));

        if (importInputRef.current) {
          importInputRef.current.value = '';
        }
      },
      `Imported ${importDraft.files.length} file${importDraft.files.length === 1 ? '' : 's'} into the local vault.`
    );
  }

  async function previewPacket(presetKey) {
    if (!activeProfile) {
      return;
    }

    await runAction(
      `packet-${presetKey}`,
      async () => {
        const preview = await request('/api/packets/preview', {
          method: 'POST',
          body: JSON.stringify({
            kind: mode,
            profileId: activeProfile.id,
            presetKey
          })
        });

        setPacketPreset((current) => ({
          ...current,
          [mode]: presetKey
        }));
        setPacketPreview((current) => ({
          ...current,
          [mode]: preview
        }));
      },
      'Packet preview refreshed.'
    );
  }

  async function exportPacket() {
    if (!activeProfile || !selectedPreset) {
      return;
    }

    await runAction(
      `export-${selectedPreset}`,
      async () => {
        const preview = await request('/api/packets/export', {
          method: 'POST',
          body: JSON.stringify({
            kind: mode,
            profileId: activeProfile.id,
            presetKey: selectedPreset
          })
        });

        setPacketExport((current) => ({
          ...current,
          [mode]: preview
        }));
        setPacketPreview((current) => ({
          ...current,
          [mode]: preview
        }));
      },
      'Packet exported to the local runtime.'
    );
  }

  async function callAi(endpoint, payload) {
    const response = await fetch(`/api/ai/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'AI request failed' }));
      throw new Error(error.error || 'AI request failed');
    }

    return response.json();
  }

  async function summarizeHistory() {
    if (!modeData) {
      return;
    }

    setAiError('');
    setAiBusy('summarize');

    try {
      const records = (modeData.documents ?? []).map((document) => ({
        title: document.title,
        recordType: document.recordType,
        documentDate: document.documentDate,
        providerName: document.providerName,
        text: document.ocrText || ''
      }));
      const result = await callAi('summarize', { records });
      setAiSummary((current) => ({ ...current, [mode]: result.summary }));
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiBusy('');
    }
  }

  async function extractFromText() {
    if (!extractText.trim()) {
      setAiError('Paste some record text to extract.');
      return;
    }

    setAiError('');
    setAiBusy('extract');

    try {
      const result = await callAi('extract', { text: extractText });
      setExtractResult(result);
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiBusy('');
    }
  }

  function addExtractedToVault() {
    if (!extractResult) {
      return;
    }

    if (DEMO_MODE && activeProfile) {
      addExtractedDocument(getKindForProfile(activeProfile.id), extractResult);
      loadBootstrap(true).catch((error) => setFlash(error.message));
      setFlash('Extracted record added to the demo vault.');
    } else {
      setFlash('Adding extracted records to the vault is only available in demo mode.');
    }

    setExtractResult(null);
    setExtractText('');
  }

  async function draftRequestLetter(item) {
    setAiError('');
    setAiBusy(`letter-${item.id}`);
    setLetter({ text: '', recordType: '' });
    setCopied(false);

    try {
      const result = await callAi('requestLetter', {
        provider: item.providerName,
        patient: activeProfile?.displayName ?? 'the patient',
        recordType: item.recordType,
        dateRange: item.startedAt ? new Date(item.startedAt).toLocaleDateString() : 'the relevant visit'
      });
      setLetter({ text: result.letter, recordType: item.recordType });
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiBusy('');
    }
  }

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letter.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const chatMessages = chatThreads[mode];

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatBusy, chatOpen]);

  async function sendChatMessage(event) {
    event.preventDefault();

    const text = chatInput.trim();
    if (!text || chatBusy) {
      return;
    }

    const history = chatThreads[mode];
    const nextHistory = [...history, { role: 'user', content: text }];

    setChatThreads((current) => ({ ...current, [mode]: nextHistory }));
    setChatInput('');
    setChatError('');
    setChatBusy(true);

    try {
      const records = (modeData?.documents ?? []).map((document) => ({
        title: document.title,
        recordType: document.recordType,
        documentDate: document.documentDate,
        providerName: document.providerName,
        ocrText: document.ocrText || ''
      }));

      const result = await callAi('chat', { messages: nextHistory, records });

      setChatThreads((current) => ({
        ...current,
        [mode]: [...current[mode], { role: 'assistant', content: result.reply }]
      }));
    } catch (error) {
      setChatError(error.message);
    } finally {
      setChatBusy(false);
    }
  }

  function clearChat() {
    setChatThreads((current) => ({ ...current, [mode]: [] }));
    setChatError('');
  }

  if (!modeData || !activeProfile) {
    return (
      <div className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Health Records</p>
          <h1>Loading local vault runtime</h1>
          <p>The SQLite-backed app shell is starting up and loading the latest vault state.</p>
        </div>
      </div>
    );
  }

  const preview = packetPreview[mode];
  const exportState = packetExport[mode];
  const selectedPreset = packetPreset[mode];

  return (
    <div className="app-shell">
      <aside className="rail rail-left">
        <div className="rail-block">
          <p className="eyebrow">Profile</p>
          <div className="profile-card">
            <strong>{activeProfile.displayName}</strong>
            <p>{activeProfile.subtitle}</p>
            {activeProfile.species ? (
              <span className="profile-meta">
                {activeProfile.species}
                {activeProfile.breed ? ` · ${activeProfile.breed}` : ''}
              </span>
            ) : null}
          </div>
          <div className="metric-stack">
            {modeData.metrics.map((metric) => (
              <article key={metric.label} className="metric-card">
                <span className="metric-label">{metric.label}</span>
                <strong className="metric-value">{metric.value}</strong>
                <p className="metric-detail">{metric.detail}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rail-block">
          <p className="eyebrow">Import records</p>
          <p className="helper-copy">
            Upload files directly into the local vault, or match them to an open request loop before intake.
          </p>
          <form className="event-form" onSubmit={importDocuments}>
            <label>
              <span>Files</span>
              <input
                ref={importInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.md,.csv,.json,.jpg,.jpeg,.png,.heic"
                onChange={(event) => updateImportFiles(event.target.files)}
              />
            </label>
            <label>
              <span>Attach to event</span>
              <select value={importDraft.eventId} onChange={(event) => updateImportEvent(event.target.value)}>
                <option value="">Standalone import</option>
                {modeData.events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title} · {formatDate(event.startedAt)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Match to open loop</span>
              <select
                value={importDraft.expectedRecordId}
                disabled={!selectedImportEvent || openExpectedRecords.length === 0}
                onChange={(event) => updateImportDraft('expectedRecordId', event.target.value)}
              >
                <option value="">No linked request</option>
                {openExpectedRecords.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.recordType} · {statusLabels[record.status] || record.status}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                <span>Provider</span>
                <select
                  value={selectedImportProviderId}
                  disabled={Boolean(selectedImportEvent)}
                  onChange={(event) => updateImportDraft('providerId', event.target.value)}
                >
                  {modeData.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Document date</span>
                <input
                  type="date"
                  value={importDraft.documentDate}
                  onChange={(event) => updateImportDraft('documentDate', event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Record type</span>
              <input
                value={importDraft.recordType}
                onChange={(event) => updateImportDraft('recordType', event.target.value)}
                placeholder={mode === 'human' ? 'lab results' : 'discharge note'}
              />
            </label>
            <p className="helper-copy helper-copy-compact">
              {importDraft.files.length > 0
                ? `${importDraft.files.length} file${importDraft.files.length === 1 ? '' : 's'} ready for intake.`
                : 'PDF and text extraction works now. Images are stored, but OCR is not in this alpha yet.'}
            </p>
            <button type="submit" className="export-button" disabled={busyKey === `import-${mode}`}>
              {busyKey === `import-${mode}` ? 'Importing…' : 'Import into local vault'}
            </button>
          </form>
        </div>

        <div className="rail-block">
          <div className="block-head">
            <p className="eyebrow">Inbound folders</p>
            <span className="result-count">{modeData.watchFolders[0]?.pendingCount ?? 0} queued</span>
          </div>
          <p className="helper-copy">
            Drop files into the inbound path if you want scan-based intake instead of a direct upload.
          </p>
          <div className="folder-list">
            {modeData.watchFolders.map((folder) => (
              <article key={folder.label} className="folder-card">
                <strong>{folder.label}</strong>
                <code>{folder.path}</code>
                <span>{folder.pendingCount} items</span>
              </article>
            ))}
          </div>
          <div className="action-row">
            <button
              type="button"
              className="secondary-button"
              disabled={busyKey === 'scan-now'}
              onClick={runWatcherScan}
            >
              {busyKey === 'scan-now' ? 'Scanning…' : 'Run scan now'}
            </button>
          </div>
        </div>

        <div className="rail-block">
          <p className="eyebrow">Create event</p>
          <form className="event-form" onSubmit={submitEvent}>
            <label>
              <span>Title</span>
              <input
                value={drafts[mode].title}
                onChange={(event) => updateDraft('title', event.target.value)}
                placeholder={mode === 'human' ? 'Orthopedic follow-up' : 'Urgent GI recheck'}
                required
              />
            </label>
            <label>
              <span>Provider</span>
              <select
                value={drafts[mode].providerId}
                onChange={(event) => updateDraft('providerId', event.target.value)}
                required
              >
                {modeData.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                <span>Event type</span>
                <select
                  value={drafts[mode].eventType}
                  onChange={(event) => updateDraft('eventType', event.target.value)}
                >
                  {eventTypeOptions[mode].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>When</span>
                <input
                  type="datetime-local"
                  value={drafts[mode].startedAt}
                  onChange={(event) => updateDraft('startedAt', event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Reason or issue</span>
              <input
                value={drafts[mode].reason}
                onChange={(event) => updateDraft('reason', event.target.value)}
                placeholder={mode === 'human' ? 'neck pain workup' : 'vomiting and GI distress'}
              />
            </label>
            <label>
              <span>Body part or focus</span>
              <input
                value={drafts[mode].bodyPart}
                onChange={(event) => updateDraft('bodyPart', event.target.value)}
                placeholder={mode === 'human' ? 'cervical spine' : 'abdomen'}
              />
            </label>
            <label>
              <span>Expected records</span>
              <textarea
                value={drafts[mode].expectedRecords}
                onChange={(event) => updateDraft('expectedRecords', event.target.value)}
                rows={3}
              />
            </label>
            <button type="submit" className="export-button" disabled={busyKey === 'create-event'}>
              {busyKey === 'create-event' ? 'Creating…' : 'Add event to workflow'}
            </button>
          </form>
        </div>
      </aside>

      <main className="main-stage">
        {DEMO_MODE ? (
          <div className="demo-banner" role="note">
            <strong>Demo data</strong>
            <span>Nothing here is real. Fictional personas, no PHI. AI features powered by OpenRouter.</span>
          </div>
        ) : null}
        <header className="hero-panel">
          <div className="hero-topline">
            <p className="eyebrow">{copy.eyebrow}</p>
            <div className="mode-switch" aria-label="Product mode">
              <button
                type="button"
                className={mode === 'human' ? 'active' : ''}
                onClick={() => setMode('human')}
              >
                Human
              </button>
              <button
                type="button"
                className={mode === 'vet' ? 'active' : ''}
                onClick={() => setMode('vet')}
              >
                Vet pilot
              </button>
            </div>
          </div>

          <div className="hero-copy">
            <div>
              <h1>{copy.title}</h1>
              <p className="tagline">{copy.tagline}</p>
            </div>
            <div className="vault-strip">
              <span className="vault-label">App shell</span>
              <code>SQLite + local vault + inbound file import</code>
            </div>
          </div>

          <p className="hero-note">{modeData.note}</p>
          {flash ? <div className="flash-banner">{flash}</div> : null}
        </header>

        <section className="ai-panel">
          <div className="block-head">
            <p className="eyebrow">AI assist</p>
            <span className="result-count">{aiBusy ? 'Working…' : 'Ready'}</span>
          </div>
          {aiError ? <div className="flash-banner ai-error">{aiError}</div> : null}

          <div className="ai-grid">
            <article className="ai-card">
              <strong>Summarize my history</strong>
              <p className="helper-copy helper-copy-compact">
                Plain-language overview of {activeProfile.displayName}'s records, meds, and open follow-ups.
              </p>
              <button
                type="button"
                className="export-button"
                disabled={aiBusy === 'summarize'}
                onClick={summarizeHistory}
              >
                {aiBusy === 'summarize' ? 'Summarizing…' : 'Summarize my history'}
              </button>
              {aiSummary[mode] ? (
                <div className="ai-output">
                  <p>{aiSummary[mode]}</p>
                </div>
              ) : null}
            </article>

            <article className="ai-card">
              <strong>Extract from record</strong>
              <p className="helper-copy helper-copy-compact">
                Paste raw record text and pull out structured fields.
              </p>
              <textarea
                className="ai-textarea"
                rows={4}
                value={extractText}
                onChange={(event) => setExtractText(event.target.value)}
                placeholder="Paste scanned or copied record text here…"
              />
              <button
                type="button"
                className="export-button"
                disabled={aiBusy === 'extract'}
                onClick={extractFromText}
              >
                {aiBusy === 'extract' ? 'Extracting…' : 'Extract structure'}
              </button>
              {extractResult ? (
                <div className="ai-output">
                  <dl className="ai-extract">
                    <div>
                      <dt>Record type</dt>
                      <dd>{extractResult.recordType || '—'}</dd>
                    </div>
                    <div>
                      <dt>Provider</dt>
                      <dd>{extractResult.provider || '—'}</dd>
                    </div>
                    <div>
                      <dt>Date</dt>
                      <dd>{extractResult.date || '—'}</dd>
                    </div>
                    <div>
                      <dt>Diagnoses</dt>
                      <dd>{(extractResult.diagnoses || []).join(', ') || '—'}</dd>
                    </div>
                    <div>
                      <dt>Medications</dt>
                      <dd>{(extractResult.medications || []).join(', ') || '—'}</dd>
                    </div>
                    <div>
                      <dt>Follow-ups</dt>
                      <dd>{(extractResult.followUps || []).join(', ') || '—'}</dd>
                    </div>
                  </dl>
                  {extractResult.summary ? <p className="ai-extract-summary">{extractResult.summary}</p> : null}
                  <div className="action-row compact">
                    <button type="button" className="ghost-button" onClick={addExtractedToVault}>
                      Add to demo vault
                    </button>
                    <button type="button" className="ghost-button" onClick={() => setExtractResult(null)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          </div>

          {letter.text ? (
            <article className="ai-card ai-letter">
              <div className="block-head">
                <strong>Records request draft — {letter.recordType}</strong>
                <button type="button" className="ghost-button" onClick={copyLetter}>
                  {copied ? 'Copied' : 'Copy letter'}
                </button>
              </div>
              <pre className="ai-letter-body">{letter.text}</pre>
            </article>
          ) : null}
        </section>

        <section className="request-panel">
          <div className="block-head">
            <p className="eyebrow">Open request loops</p>
            <span className="result-count">{modeData.requestBoard.length} active</span>
          </div>
          <div className="request-grid">
            {modeData.requestBoard.map((item) => (
              <article key={item.id} className="request-card">
                <div className="timeline-header">
                  <span className="timeline-date">{statusLabels[item.status] || item.status}</span>
                  <span className={`state-chip state-inline state-${item.status}`}>{item.recordType}</span>
                </div>
                <strong>{item.eventTitle}</strong>
                <p className="record-provider">{item.providerName}</p>
                <p className="request-meta">
                  {item.requestCount} request attempts · next follow-up {formatDate(item.nextFollowUpAt)}
                </p>
                <div className="action-row compact">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busyKey === `${item.status === 'pending' ? 'request' : 'followup'}-${item.id}`}
                    onClick={() => (item.status === 'pending' ? requestRecord(item.id) : followUpRecord(item.id))}
                  >
                    {item.status === 'pending' ? 'Log request' : 'Log follow-up'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={busyKey === `receive-${item.id}`}
                    onClick={() => markReceived(item.id)}
                  >
                    Mark received
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={aiBusy === `letter-${item.id}`}
                    onClick={() => draftRequestLetter(item)}
                  >
                    {aiBusy === `letter-${item.id}` ? 'Drafting…' : 'Draft request'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="timeline-panel">
          <div className="panel-label">Event to request to receipt</div>
          <div className="timeline-seam" aria-hidden="true" />
          {modeData.events.map((event, index) => (
            <article
              key={event.id}
              className={`timeline-card ${index % 2 === 0 ? 'left' : 'right'}`}
            >
              <div className="timeline-header">
                <span className="timeline-date">{formatDate(event.startedAt)}</span>
                <span className={`state-chip state-inline state-${event.status}`}>
                  {statusLabels[event.status] || event.status}
                </span>
              </div>
              <h2>{event.title}</h2>
              <p className="provider-line">
                {event.providerName} · {event.eventType}
              </p>
              <p className="timeline-summary">
                {event.reason || 'No reason entered'}
                {event.bodyPart ? ` · ${event.bodyPart}` : ''}
              </p>

              <div className="expected-stack">
                {event.expectedRecords.map((record) => (
                  <div key={record.id} className={`expected-row state-${record.status}`}>
                    <div className="expected-copy">
                      <strong>{record.recordType}</strong>
                      <span>
                        {statusLabels[record.status] || record.status}
                        {record.requestCount ? ` · ${record.requestCount} requests` : ''}
                        {record.nextFollowUpAt ? ` · next ${formatDate(record.nextFollowUpAt)}` : ''}
                      </span>
                    </div>
                    <div className="action-row compact">
                      {record.status === 'pending' ? (
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={busyKey === `request-${record.id}`}
                          onClick={() => requestRecord(record.id)}
                        >
                          Log request
                        </button>
                      ) : null}
                      {record.status === 'requested' || record.status === 'partial' ? (
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={busyKey === `followup-${record.id}`}
                          onClick={() => followUpRecord(record.id)}
                        >
                          Log follow-up
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>

      <aside className="rail rail-right">
        <div className="rail-block">
          <div className="search-head">
            <p className="eyebrow">Search the vault</p>
            <span className="result-count">{filteredDocuments.length} files</span>
          </div>
          <label className="search-shell">
            <span>Search by provider, issue, record type, or tag</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="MRI, vaccines, headache, Poppy"
            />
          </label>
          <div className="record-list">
            {filteredDocuments.map((document) => (
              <article key={document.id} className="record-card">
                <strong>{document.title}</strong>
                <span className="record-provider">
                  {document.providerName} · {document.recordType} · {document.documentDate}
                </span>
                <span className="path-line">{document.vaultPath}</span>
                <div className="chip-cloud compact">
                  {document.tags.map((tag) => (
                    <span key={tag} className="tax-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rail-block packet-builder">
          <p className="eyebrow">Packet builder</p>
          <div className="packet-tabs">
            {modeData.packetPresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={selectedPreset === preset.key ? 'active' : ''}
                onClick={() => previewPacket(preset.key)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="packet-card">
            <strong>
              {modeData.packetPresets.find((preset) => preset.key === selectedPreset)?.name || 'Packet preview'}
            </strong>
            <p>
              {modeData.packetPresets.find((preset) => preset.key === selectedPreset)?.detail ||
                'Select a preset to preview the generated packet manifest.'}
            </p>
            <ul className="packet-checklist">
              {(preview?.manifest ?? []).map((item) => (
                <li key={`${item.line}-${item.title}`}>
                  {item.title} · {item.providerName} · {item.documentDate}
                </li>
              ))}
            </ul>
            <div className="action-row">
              <button type="button" className="ghost-button" onClick={() => previewPacket(selectedPreset)}>
                Refresh preview
              </button>
              <button type="button" className="export-button packet-export-button" onClick={exportPacket}>
                Export packet files
              </button>
            </div>
            {exportState?.exportDir ? (
              <div className="export-summary">
                <strong>Local export</strong>
                <code>{exportState.exportDir}</code>
                {exportState.files.map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rail-block">
          <p className="eyebrow">Local audit trail</p>
          <div className="audit-list">
            {modeData.audit.map((entry) => (
              <article key={entry.id} className="audit-card">
                <strong>{entry.message}</strong>
                <span>{formatDate(entry.createdAt)}</span>
              </article>
            ))}
          </div>
        </div>
      </aside>

      {DEMO_MODE ? (
        <div className="chat-widget">
          {chatOpen ? (
            <section className="chat-window" aria-label="Records assistant">
              <header className="chat-head">
                <div>
                  <p className="eyebrow">Records assistant</p>
                  <strong>Ask about {activeProfile.displayName}</strong>
                </div>
                <div className="chat-head-actions">
                  {chatMessages.length > 0 ? (
                    <button type="button" className="chat-icon-button" onClick={clearChat} title="Clear conversation">
                      Clear
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="chat-icon-button"
                    onClick={() => setChatOpen(false)}
                    aria-label="Close chat"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </header>

              <div className="chat-scroll" ref={chatScrollRef}>
                {chatMessages.length === 0 ? (
                  <div className="chat-intro">
                    <p>
                      I can answer questions about the records in this vault, explain what a result or visit
                      summary means in plain language, and walk you through packets, requests, and the timeline.
                    </p>
                    <p className="chat-disclaimer">Organizational help only — not medical advice.</p>
                    <div className="chat-suggestions">
                      {[
                        'What records are in my vault?',
                        'What does my latest visit cover?',
                        'How do I build a packet for a new clinic?'
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="chat-suggestion"
                          onClick={() => setChatInput(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chatMessages.map((message, index) => (
                    <div key={index} className={`chat-bubble chat-${message.role}`}>
                      {message.content}
                    </div>
                  ))
                )}
                {chatBusy ? <div className="chat-bubble chat-assistant chat-typing">Thinking…</div> : null}
                {chatError ? <div className="chat-bubble chat-error">{chatError}</div> : null}
              </div>

              <form className="chat-compose" onSubmit={sendChatMessage}>
                <textarea
                  rows={2}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendChatMessage(event);
                    }
                  }}
                  placeholder="Ask about your records or the app…"
                />
                <button type="submit" className="export-button chat-send" disabled={chatBusy || !chatInput.trim()}>
                  {chatBusy ? 'Sending…' : 'Send'}
                </button>
              </form>
            </section>
          ) : null}

          <button
            type="button"
            className="chat-fab"
            onClick={() => setChatOpen((open) => !open)}
            aria-expanded={chatOpen}
            aria-label={chatOpen ? 'Close records assistant' : 'Open records assistant'}
          >
            {chatOpen ? '✕' : 'Ask AI'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
