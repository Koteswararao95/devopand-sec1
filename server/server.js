import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { cloneRepo, cleanupDir } from './utils.js';
import { runForgeAgent } from './agent.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Main Forge Endpoint using Chunked Streaming Response
app.post('/api/forge', async (req, res) => {
  const { repoUrl, apiKey: userApiKey, mode } = req.body;
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;

  if (!repoUrl) {
    return res.status(400).json({ error: 'GitHub Repository URL is required.' });
  }
  if (!apiKey) {
    return res.status(400).json({ error: 'Gemini API Key is required. Please set it in the Settings panel or in a .env file.' });
  }

  // Setup streaming response
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked'
  });

  const sendProgress = (type, message) => {
    res.write(JSON.stringify({ type, message }) + '\n');
  };

  const tempDir = path.join(__dirname, 'temp-clones', `repo-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);

  try {
    sendProgress('System', `Validating repo: ${repoUrl}`);
    sendProgress('System', 'Cloning GitHub repository...');
    
    await cloneRepo(repoUrl, tempDir);
    sendProgress('System', 'Repository cloned successfully.');

    // Run the agent
    const result = await runForgeAgent({
      repoUrl,
      dir: tempDir,
      apiKey,
      mode,
      logCallback: (type, message) => sendProgress(type, message)
    });

    sendProgress('RESULT', result);
  } catch (error) {
    sendProgress('ERROR', error.message);
  } finally {
    sendProgress('System', 'Cleaning up temporary clone directory...');
    await cleanupDir(tempDir);
    sendProgress('System', 'Cleanup complete.');
    res.end();
  }
});

// Serve frontend assets in production
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

app.get('*', async (req, res) => {
  try {
    const indexPath = path.join(distPath, 'index.html');
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch (err) {
    // If client build doesn't exist, present a placeholder API status message
    res.status(200).send(`
      <div style="font-family: system-ui, sans-serif; text-align: center; padding: 4rem; background: #0b0f19; color: #f3f4f6; min-height: 100vh;">
        <h1 style="color: #6366f1;">DockerForge API Server</h1>
        <p style="color: #9ca3af;">Backend API running on port ${PORT}. Client dashboard not built yet. Run 'npm run dev' to start full development mode!</p>
      </div>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`  DockerForge server running on port ${PORT}  `);
  console.log(`  Local: http://localhost:${PORT}            `);
  console.log(`==========================================`);
});
