

const path = require('path');
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');

// Set up multer for file uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

const app = express();
// Enable CORS for Vercel frontend
app.use(cors({
  origin: 'https://portofolio-hussein.vercel.app'
}));
const PORT = process.env.PORT || 3000;

// Simple JSON data loader
function loadProjects() {
  const p = path.join(__dirname, 'data', 'projects.json');
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse projects.json', err);
    return [];
  }
}


app.use(express.json());

// Image upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ filename: req.file.filename, originalname: req.file.originalname });
});

// API endpoints
app.get('/api/projects', (req, res) => {
  const projects = loadProjects();
  res.json(projects.map(p => ({
    id: p.id,
    name: p.name,
    short: p.short,
    media: p.media && p.media.length ? [p.media.find(m => m.type === 'image')].filter(Boolean) : []
  })));
});

app.get('/api/projects/:id', (req, res) => {
  const projects = loadProjects();
  const proj = projects.find(p => String(p.id) === String(req.params.id));
  if (!proj) return res.status(404).json({ error: 'Not found' });
  res.json(proj);
});

// Serve client static files if present
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  // SPA fallback for non-API GET requests (avoid path-to-regexp issues)
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    if (req.path.startsWith('/api')) return next()
    // let static middleware handle actual asset files; if not found, serve index.html
    res.sendFile(path.join(clientBuildPath, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res.send('Portfolio server running. Build the client and place it in client/dist to serve static files.');
  });
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
