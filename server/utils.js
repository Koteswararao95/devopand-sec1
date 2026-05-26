import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execPromise = promisify(exec);

/**
 * Safely clones a public Git repository into a target directory.
 */
export async function cloneRepo(repoUrl, targetDir) {
  // Ensure the target directory exists
  await fs.mkdir(targetDir, { recursive: true });

  // Clean URL to prevent command injection
  const sanitizedUrl = repoUrl.replace(/[^a-zA-Z0-9:\/\-\._~]/g, '');
  if (!sanitizedUrl.startsWith('http://') && !sanitizedUrl.startsWith('https://') && !sanitizedUrl.startsWith('git@')) {
    throw new Error('Invalid Git repository URL format.');
  }

  const command = `git clone --depth 1 "${sanitizedUrl}" "${targetDir}"`;
  
  try {
    const { stdout, stderr } = await execPromise(command);
    return { stdout, stderr };
  } catch (error) {
    throw new Error(`Git clone failed: ${error.message}`);
  }
}

/**
 * Recursively scans a directory and builds a text-based tree view.
 * Also gathers critical file content.
 */
export async function scanCodebase(dir, relativeRoot = '') {
  const currentDir = relativeRoot ? path.join(dir, relativeRoot) : dir;
  let items;
  try {
    items = await fs.readdir(currentDir, { withFileTypes: true });
  } catch (err) {
    return { tree: '', configFiles: [] };
  }

  let tree = '';
  let configFiles = [];

  const ignoreList = ['.git', 'node_modules', 'venv', '.venv', '__pycache__', 'dist', 'build', '.next', '.nuxt', 'out'];

  // Sort: Directories first, then files alphabetically
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    if (ignoreList.includes(item.name)) continue;

    const relPath = relativeRoot ? `${relativeRoot}/${item.name}` : item.name;
    const fullPath = path.join(dir, relPath);

    if (item.isDirectory()) {
      tree += `${relativeRoot ? '  '.repeat(relativeRoot.split('/').length) : ''}📁 ${item.name}/\n`;
      const subResult = await scanCodebase(dir, relPath);
      tree += subResult.tree;
      configFiles.push(...subResult.configFiles);
    } else {
      tree += `${relativeRoot ? '  '.repeat(relativeRoot.split('/').length) : ''}📄 ${item.name}\n`;

      // Check if this is an interesting configuration or entry point file
      const lowercaseName = item.name.toLowerCase();
      const isConfigFile = [
        'package.json',
        'requirements.txt',
        'pipfile',
        'gemfile',
        'go.mod',
        'cargo.toml',
        'composer.json',
        'makefile',
        'dockerfile',
        'docker-compose.yml',
        'angular.json',
        'tsconfig.json',
        'webpack.config.js'
      ].includes(lowercaseName) || 
      lowercaseName.endsWith('.env.example') || 
      // Main entrypoints (limit to small read size)
      ['server.js', 'app.js', 'index.js', 'main.py', 'manage.py', 'app.py', 'main.go'].includes(lowercaseName);

      if (isConfigFile) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          // Limit length to avoid blowing up context window (max 10000 chars per file)
          const truncatedContent = content.length > 10000 ? content.substring(0, 10000) + '\n... [TRUNCATED] ...' : content;
          configFiles.push({
            name: relPath,
            content: truncatedContent
          });
        } catch (e) {
          // Ignore files we can't read
        }
      }
    }
  }

  return { tree, configFiles };
}

/**
 * Recursively cleans up a temporary directory.
 */
export async function cleanupDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to clean up directory ${dir}:`, err.message);
  }
}
