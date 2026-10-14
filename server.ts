import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Increase payload limit for audio files (base64 samples)
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Data storage paths
const DATA_DIR = path.resolve(__dirname, 'data');
const SAMPLES_DIR = path.resolve(DATA_DIR, 'samples');
const RHYTHMS_FILE = path.resolve(DATA_DIR, 'rhythms.json');
const SAMPLES_INDEX_FILE = path.resolve(DATA_DIR, 'samples_index.json');
const DATA_SAMPLES_INDEX_FILE = path.resolve(DATA_DIR, 'samples/index.json');
const ACTIVE_RHYTHM_FILE = path.resolve(DATA_DIR, 'active_rhythm.json');
const DELETED_REGISTRY_FILE = path.resolve(DATA_DIR, 'deleted_registry.json');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PUBLIC_SAMPLES_DIR = path.resolve(PUBLIC_DIR, 'samples');
const PUBLIC_RHYTHMS_FILE = path.resolve(PUBLIC_DIR, 'rhythms.json');
const PUBLIC_SAMPLES_INDEX_FILE = path.resolve(PUBLIC_DIR, 'samples/index.json');
const PUBLIC_ACTIVE_RHYTHM_FILE = path.resolve(PUBLIC_DIR, 'active_rhythm.json');
const PUBLIC_DELETED_REGISTRY_FILE = path.resolve(PUBLIC_DIR, 'deleted_registry.json');

const DIST_DIR = path.resolve(__dirname, 'dist');
const DIST_SAMPLES_DIR = path.resolve(DIST_DIR, 'samples');

// Ensure storage directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(SAMPLES_DIR)) {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_SAMPLES_DIR)) {
  fs.mkdirSync(PUBLIC_SAMPLES_DIR, { recursive: true });
}

interface StoredSampleMeta {
  id: string;
  name: string;
  mimeType: string;
  fileName: string;
  size: number;
  createdAt: number;
}

interface DeletedRegistry {
  deletedRhythms: string[];
  deletedSamples: string[];
}

function loadDeletedRegistry(): DeletedRegistry {
  try {
    if (fs.existsSync(DELETED_REGISTRY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DELETED_REGISTRY_FILE, 'utf-8'));
      return {
        deletedRhythms: Array.isArray(parsed.deletedRhythms) ? parsed.deletedRhythms : [],
        deletedSamples: Array.isArray(parsed.deletedSamples) ? parsed.deletedSamples : [],
      };
    }
    if (fs.existsSync(PUBLIC_DELETED_REGISTRY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PUBLIC_DELETED_REGISTRY_FILE, 'utf-8'));
      return {
        deletedRhythms: Array.isArray(parsed.deletedRhythms) ? parsed.deletedRhythms : [],
        deletedSamples: Array.isArray(parsed.deletedSamples) ? parsed.deletedSamples : [],
      };
    }
  } catch (e) {
    console.error('Error loading deleted registry:', e);
  }
  return { deletedRhythms: [], deletedSamples: [] };
}

function markDeletedOnServer(type: 'rhythm' | 'sample', ...identifiers: (string | undefined)[]) {
  try {
    const reg = loadDeletedRegistry();
    const set = new Set(type === 'rhythm' ? reg.deletedRhythms : reg.deletedSamples);
    for (const id of identifiers) {
      if (!id) continue;
      const clean = id.trim();
      set.add(clean);
      set.add(clean.toLowerCase());
      set.add(clean.toLowerCase().replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, ''));
    }
    if (type === 'rhythm') {
      reg.deletedRhythms = Array.from(set);
    } else {
      reg.deletedSamples = Array.from(set);
    }
    const jsonStr = JSON.stringify(reg, null, 2);
    fs.writeFileSync(DELETED_REGISTRY_FILE, jsonStr, 'utf-8');
    fs.writeFileSync(PUBLIC_DELETED_REGISTRY_FILE, jsonStr, 'utf-8');
    if (fs.existsSync(DIST_DIR)) {
      fs.writeFileSync(path.resolve(DIST_DIR, 'deleted_registry.json'), jsonStr, 'utf-8');
    }
  } catch (e) {
    console.error('Error saving deleted registry:', e);
  }
}

function loadRhythms(): unknown[] {
  const reg = loadDeletedRegistry();
  const deletedSet = new Set(reg.deletedRhythms.map((r) => r.toLowerCase()));

  try {
    if (fs.existsSync(RHYTHMS_FILE)) {
      const data = fs.readFileSync(RHYTHMS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter((r) => r && r.id && !deletedSet.has(String(r.id).toLowerCase()));
      }
    }
  } catch (err) {
    console.error('Error loading rhythms.json:', err);
  }
  try {
    if (fs.existsSync(PUBLIC_RHYTHMS_FILE)) {
      const data = fs.readFileSync(PUBLIC_RHYTHMS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.filter((r) => r && r.id && !deletedSet.has(String(r.id).toLowerCase()));
      }
    }
  } catch (err) {
    console.error('Error loading public/rhythms.json:', err);
  }
  return [];
}

function saveRhythms(rhythms: unknown[]) {
  try {
    const jsonStr = JSON.stringify(rhythms, null, 2);
    fs.writeFileSync(RHYTHMS_FILE, jsonStr, 'utf-8');
    fs.writeFileSync(PUBLIC_RHYTHMS_FILE, jsonStr, 'utf-8');
    if (fs.existsSync(DIST_DIR)) {
      fs.writeFileSync(path.resolve(DIST_DIR, 'rhythms.json'), jsonStr, 'utf-8');
    }
  } catch (err) {
    console.error('Error saving rhythms.json:', err);
  }
}

function saveActiveRhythm(rhythmId: string) {
  try {
    const jsonStr = JSON.stringify({ rhythmId }, null, 2);
    fs.writeFileSync(ACTIVE_RHYTHM_FILE, jsonStr, 'utf-8');
    fs.writeFileSync(PUBLIC_ACTIVE_RHYTHM_FILE, jsonStr, 'utf-8');
    if (fs.existsSync(DIST_DIR)) {
      fs.writeFileSync(path.resolve(DIST_DIR, 'active_rhythm.json'), jsonStr, 'utf-8');
    }
  } catch (err) {
    console.error('Error saving active rhythm file:', err);
  }
}

function loadSamplesMeta(): StoredSampleMeta[] {
  const reg = loadDeletedRegistry();
  const deletedSet = new Set(reg.deletedSamples.map((s) => s.toLowerCase()));

  const filterOutDeleted = (list: StoredSampleMeta[]) => {
    return list.filter((s) => {
      if (!s) return false;
      const id = String(s.id || '').toLowerCase();
      const name = String(s.name || '').toLowerCase();
      const nameStem = name.replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, '');
      const file = String(s.fileName || '').toLowerCase();
      return (
        !deletedSet.has(id) &&
        !deletedSet.has(name) &&
        !deletedSet.has(nameStem) &&
        !deletedSet.has(file)
      );
    });
  };

  try {
    if (fs.existsSync(SAMPLES_INDEX_FILE)) {
      const data = fs.readFileSync(SAMPLES_INDEX_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return filterOutDeleted(parsed);
      }
    }
  } catch (err) {
    console.error('Error loading samples_index.json:', err);
  }
  try {
    if (fs.existsSync(PUBLIC_SAMPLES_INDEX_FILE)) {
      const data = fs.readFileSync(PUBLIC_SAMPLES_INDEX_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return filterOutDeleted(parsed);
      }
    }
  } catch (err) {
    console.error('Error loading public samples index:', err);
  }
  return [];
}

function saveSamplesMeta(metaList: StoredSampleMeta[]) {
  try {
    const jsonStr = JSON.stringify(metaList, null, 2);
    // 1. data/samples_index.json
    fs.writeFileSync(SAMPLES_INDEX_FILE, jsonStr, 'utf-8');
    // 2. data/samples/index.json
    fs.writeFileSync(DATA_SAMPLES_INDEX_FILE, jsonStr, 'utf-8');
    // 3. public/samples/index.json
    fs.writeFileSync(PUBLIC_SAMPLES_INDEX_FILE, jsonStr, 'utf-8');
    // 4. dist/samples/index.json (if dist exists)
    if (fs.existsSync(DIST_DIR)) {
      if (!fs.existsSync(DIST_SAMPLES_DIR)) {
        fs.mkdirSync(DIST_SAMPLES_DIR, { recursive: true });
      }
      fs.writeFileSync(path.resolve(DIST_SAMPLES_DIR, 'index.json'), jsonStr, 'utf-8');
    }
  } catch (err) {
    console.error('Error saving samples index files:', err);
  }
}

function deleteSampleFilesFromDisk(identifier: string, sample?: StoredSampleMeta): string[] {
  const dirs = [
    SAMPLES_DIR,
    PUBLIC_SAMPLES_DIR,
    ...(fs.existsSync(DIST_SAMPLES_DIR) ? [DIST_SAMPLES_DIR] : []),
  ];

  const tokens = new Set<string>();
  const addToken = (str?: string) => {
    if (!str) return;
    const clean = str.trim().toLowerCase();
    if (!clean) return;
    tokens.add(clean);
    tokens.add(clean.replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, ''));
  };

  addToken(identifier);
  if (sample) {
    addToken(sample.id);
    addToken(sample.name);
    addToken(sample.fileName);
  }

  const removed: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === 'index.json') continue;
        const lowerFile = file.toLowerCase();
        const lowerStem = file.toLowerCase().replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, '');

        let match = false;
        for (const tok of tokens) {
          if (
            lowerFile === tok ||
            lowerStem === tok ||
            lowerFile.startsWith(`${tok}.`) ||
            (tok.startsWith('sample_') && lowerFile.startsWith(tok))
          ) {
            match = true;
            break;
          }
        }

        if (match) {
          const fullPath = path.resolve(dir, file);
          try {
            if (fs.existsSync(fullPath)) {
              fs.unlinkSync(fullPath);
              removed.push(fullPath);
            }
          } catch (e) {
            console.error(`Failed to delete file ${fullPath}:`, e);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to scan dir ${dir} for deletion:`, e);
    }
  }

  return removed;
}

// ================= API ENDPOINTS ================= //

// 1. Get all synced rhythms
app.get('/api/rhythms', (_req: Request, res: Response) => {
  const list = loadRhythms();
  res.json({ success: true, rhythms: list });
});

// 2. Save all synced rhythms (called whenever a rhythm is created, modified or deleted)
app.post('/api/rhythms', (req: Request, res: Response) => {
  const { rhythms } = req.body;
  if (!Array.isArray(rhythms)) {
    res.status(400).json({ success: false, error: 'Expected rhythms array' });
    return;
  }
  saveRhythms(rhythms);
  res.json({ success: true, count: rhythms.length });
});

// 2.1 Get & Set active rhythm
app.get('/api/active_rhythm', (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(ACTIVE_RHYTHM_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACTIVE_RHYTHM_FILE, 'utf-8'));
      if (data.rhythmId) {
        res.json({ success: true, rhythmId: data.rhythmId });
        return;
      }
    }
    if (fs.existsSync(PUBLIC_ACTIVE_RHYTHM_FILE)) {
      const data = JSON.parse(fs.readFileSync(PUBLIC_ACTIVE_RHYTHM_FILE, 'utf-8'));
      if (data.rhythmId) {
        res.json({ success: true, rhythmId: data.rhythmId });
        return;
      }
    }
  } catch (e) {
    console.error(e);
  }
  res.json({ success: true, rhythmId: null });
});

app.post('/api/active_rhythm', (req: Request, res: Response) => {
  try {
    const { rhythmId } = req.body;
    if (rhythmId) {
      const str = JSON.stringify({ rhythmId });
      fs.writeFileSync(ACTIVE_RHYTHM_FILE, str, 'utf-8');
      fs.writeFileSync(PUBLIC_ACTIVE_RHYTHM_FILE, str, 'utf-8');
    }
    res.json({ success: true, rhythmId });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to save active rhythm' });
  }
});

// 2.2 Delete a rhythm permanently from disk & storage
app.delete('/api/rhythms/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  markDeletedOnServer('rhythm', id);

  const rhythms = loadRhythms() as Array<{ id?: string }>;
  const filtered = rhythms.filter((r) => r && r.id !== id);
  saveRhythms(filtered);

  // If deleted rhythm was active, reset active rhythm to first remaining
  try {
    let currentActiveId: string | null = null;
    if (fs.existsSync(ACTIVE_RHYTHM_FILE)) {
      currentActiveId = JSON.parse(fs.readFileSync(ACTIVE_RHYTHM_FILE, 'utf-8')).rhythmId;
    } else if (fs.existsSync(PUBLIC_ACTIVE_RHYTHM_FILE)) {
      currentActiveId = JSON.parse(fs.readFileSync(PUBLIC_ACTIVE_RHYTHM_FILE, 'utf-8')).rhythmId;
    }

    if (currentActiveId === id || !currentActiveId) {
      const nextId = (filtered[0] as { id?: string })?.id || '';
      saveActiveRhythm(nextId);
    }
  } catch (e) {
    console.error('Error updating active rhythm on delete:', e);
  }

  res.json({ success: true, id, remaining: filtered.length });
});

// 2.3 Get deleted registry
app.get('/api/deleted_registry', (_req: Request, res: Response) => {
  res.json(loadDeletedRegistry());
});

// 3. Get all synced samples list
app.get('/api/samples', (_req: Request, res: Response) => {
  const samples = loadSamplesMeta();
  res.json({ success: true, samples });
});

// Serve static samples directory directly
app.use('/samples', express.static(path.resolve(__dirname, 'public/samples')));
app.use('/samples', express.static(SAMPLES_DIR));

// 4. Download a sample's raw audio binary
app.get('/api/samples/:id/audio', (req: Request, res: Response) => {
  const { id } = req.params;
  const samples = loadSamplesMeta();
  const sample = samples.find((s) => s.id === id);

  // Check multiple possible paths
  const possiblePaths = [
    sample ? path.resolve(SAMPLES_DIR, sample.fileName) : null,
    sample ? path.resolve(__dirname, 'public/samples', sample.fileName) : null,
    path.resolve(SAMPLES_DIR, `${id}.wav`),
    path.resolve(__dirname, 'public/samples', `${id}.wav`),
    path.resolve(SAMPLES_DIR, `${id}.webm`),
    path.resolve(__dirname, 'public/samples', `${id}.webm`),
  ].filter(Boolean) as string[];

  let foundPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath && fs.existsSync(path.resolve(__dirname, 'public/samples'))) {
    const files = fs.readdirSync(path.resolve(__dirname, 'public/samples'));
    const match = files.find((f) => f.includes(id));
    if (match) {
      foundPath = path.resolve(__dirname, 'public/samples', match);
    }
  }

  if (!foundPath) {
    res.status(404).send('Audio file not found on disk');
    return;
  }

  res.setHeader('Content-Type', sample?.mimeType || 'audio/wav');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  fs.createReadStream(foundPath).pipe(res);
});

// 5. Upload a sample (Base64 data URL or pure Base64)
app.post('/api/samples', (req: Request, res: Response) => {
  try {
    const { id, name, mimeType, base64Data } = req.body;
    if (!id || !name || !base64Data) {
      res.status(400).json({ success: false, error: 'Missing id, name, or base64Data' });
      return;
    }

    // Clean data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:audio\/[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const safeExt = (mimeType && mimeType.includes('webm')) ? 'webm' : (mimeType && mimeType.includes('mp3')) ? 'mp3' : 'wav';
    const fileName = `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${safeExt}`;
    const filePath = path.resolve(SAMPLES_DIR, fileName);

    fs.writeFileSync(filePath, buffer);

    // Also persist directly into public/samples directory for instant mobile access
    const pubSamplesDir = path.resolve(PUBLIC_DIR, 'samples');
    if (!fs.existsSync(pubSamplesDir)) {
      fs.mkdirSync(pubSamplesDir, { recursive: true });
    }
    const publicFilePath = path.resolve(pubSamplesDir, fileName);
    fs.writeFileSync(publicFilePath, buffer);

    const samples = loadSamplesMeta();
    const existingIdx = samples.findIndex((s) => s.id === id);
    const meta: StoredSampleMeta = {
      id,
      name,
      mimeType: mimeType || 'audio/wav',
      fileName,
      size: buffer.length,
      createdAt: Date.now(),
    };

    if (existingIdx >= 0) {
      samples[existingIdx] = meta;
    } else {
      samples.push(meta);
    }
    saveSamplesMeta(samples);

    res.json({ success: true, sample: meta });
  } catch (err) {
    console.error('Error saving sample:', err);
    res.status(500).json({ success: false, error: 'Internal server error saving sample' });
  }
});

// 6. Delete a sample permanently from disk, index files and rhythms
app.delete('/api/samples/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const samples = loadSamplesMeta();
  const lowerId = id.toLowerCase();
  const lowerStem = lowerId.replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, '');

  const sample = samples.find((s) => {
    const sId = (s.id || '').toLowerCase();
    const sName = (s.name || '').toLowerCase();
    const sStem = sName.replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, '');
    const sFile = (s.fileName || '').toLowerCase();
    return (
      sId === lowerId ||
      sName === lowerId ||
      sStem === lowerStem ||
      sFile === lowerId ||
      sFile === `${lowerStem}.wav`
    );
  });

  const targetId = sample ? sample.id : id;

  // 1. Mark as deleted in server-side registry so it is never re-indexed or served
  markDeletedOnServer('sample', id, targetId, sample?.name, sample?.fileName);

  // 2. Permanently delete all matching audio files from data/samples, public/samples, and dist/samples
  const removedFiles = deleteSampleFilesFromDisk(id, sample);

  // 3. Update samples metadata in all index json files (data/samples_index.json, data/samples/index.json, public/samples/index.json, dist/samples/index.json)
  const filtered = samples.filter((s) => {
    const sId = (s.id || '').toLowerCase();
    const sName = (s.name || '').toLowerCase();
    const sStem = sName.replace(/\.(wav|mp3|ogg|webm|flac|m4a|aac)$/i, '');
    const sFile = (s.fileName || '').toLowerCase();
    return (
      sId !== lowerId &&
      sId !== targetId.toLowerCase() &&
      sName !== lowerId &&
      sStem !== lowerStem &&
      sFile !== lowerId
    );
  });
  saveSamplesMeta(filtered);

  // 4. Update rhythms.json: strip this deleted sample from all tracks across all rhythms
  try {
    const currentRhythms = loadRhythms() as any[];
    let rhythmChanged = false;
    for (const r of currentRhythms) {
      if (r && Array.isArray(r.tracks)) {
        for (const t of r.tracks) {
          if (
            t.customSampleId === targetId ||
            t.customSampleId === id ||
            (sample?.name && t.customSampleName === sample.name) ||
            (sample?.name && t.name === sample.name)
          ) {
            t.customSampleId = undefined;
            t.customSampleName = undefined;
            if (t.soundType === 'custom') {
              t.soundType = 'kick';
            }
            rhythmChanged = true;
          }
        }
      }
    }
    if (rhythmChanged) {
      saveRhythms(currentRhythms);
    }
  } catch (err) {
    console.error('Error stripping sample from rhythms:', err);
  }

  res.json({ success: true, id: targetId, removedFilesCount: removedFiles.length });
});

// 7. Rename a sample
app.put('/api/samples/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name } = req.body;
  const samples = loadSamplesMeta();
  const sample = samples.find((s) => s.id === id);
  if (sample && name) {
    sample.name = name;
    saveSamplesMeta(samples);
    res.json({ success: true, sample });
  } else {
    res.status(404).json({ success: false, error: 'Sample not found' });
  }
});

// ================= VITE DEV OR STATIC SERVER ================= //

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(__dirname, 'dist');

  if (isProd && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`> BeatBuddy Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
