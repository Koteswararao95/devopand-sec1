import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import http from 'http';

const execPromise = promisify(exec);

/**
 * Checks if the docker command is available on the system.
 */
export async function isDockerAvailable() {
  try {
    const { stdout } = await execPromise('docker --version');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Runs a real Docker build and execution test.
 */
export async function buildAndRunReal(dir, dockerfileContent, port, logCallback) {
  const tag = `dockerforge-${Date.now()}`;
  const containerName = `dockerforge-container-${Date.now()}`;

  // Write the Dockerfile into the cloned directory
  await fs.writeFile(path.join(dir, 'Dockerfile'), dockerfileContent, 'utf8');

  logCallback('System', 'Starting real Docker build...');
  
  // 1. Docker Build
  try {
    const buildProcess = exec(`docker build -t ${tag} .`, { cwd: dir });
    
    buildProcess.stdout.on('data', (data) => logCallback('Docker Build', data.toString()));
    buildProcess.stderr.on('data', (data) => logCallback('Docker Build', data.toString()));

    await new Promise((resolve, reject) => {
      buildProcess.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Docker build failed with exit code ${code}`));
      });
    });
  } catch (error) {
    logCallback('System', `Docker build failed: ${error.message}`);
    throw error;
  }

  // 2. Docker Run
  logCallback('System', `Starting container on port ${port}...`);
  try {
    // Run container in detached mode, forwarding host port to container's port
    // We assume the container exposes the target port or we can inspect it.
    // For simplicity, we forward the host port to the container port.
    // The agent will generate a Dockerfile that EXPOSEs a certain port (default 3000).
    const exposedPort = detectExposedPort(dockerfileContent) || 3000;
    
    const runCommand = `docker run -d -p ${port}:${exposedPort} --name ${containerName} ${tag}`;
    logCallback('System', `Running: ${runCommand}`);
    
    const { stdout: containerId } = await execPromise(runCommand);
    logCallback('System', `Container started. ID: ${containerId.trim().substring(0, 12)}`);

    // Let the container boot up (wait 3 seconds)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get logs
    const { stdout: containerLogs } = await execPromise(`docker logs ${containerName}`);
    logCallback('Container Output', containerLogs);

    // 3. Health Check
    logCallback('System', `Testing responsiveness on http://localhost:${port}...`);
    const isHealthy = await pingServer(port);
    if (!isHealthy) {
      throw new Error(`Container is running, but http://localhost:${port} did not respond. Check if the start command serves on 0.0.0.0.`);
    }

    logCallback('System', 'Verification successful! Container starts and responds.');
    
    // Clean up container
    await execPromise(`docker stop ${containerName}`);
    await execPromise(`docker rm ${containerName}`);
    
    return { success: true, logs: 'Success' };
  } catch (error) {
    logCallback('System', `Container run failed or verification failed: ${error.message}`);
    
    // Attempt to gather logs before cleanup
    try {
      const { stdout: errLogs } = await execPromise(`docker logs ${containerName}`);
      logCallback('Container Error Logs', errLogs);
    } catch (_) {}

    // Cleanup
    try {
      await execPromise(`docker stop ${containerName}`);
      await execPromise(`docker rm ${containerName}`);
    } catch (_) {}
    
    throw error;
  }
}

/**
 * Heuristically parses the EXPOSE port from a Dockerfile.
 */
function detectExposedPort(dockerfile) {
  const match = dockerfile.match(/EXPOSE\s+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Pings local HTTP server to verify container health.
 */
function pingServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400 || res.statusCode === 404); // 404 is still running!
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * A highly intelligent Docker Simulator.
 * Parses the generated Dockerfile, runs mock build steps, checks for standard developer
 * errors relative to the actual codebase contents, and outputs highly realistic terminal logs.
 * This lets the agentic self-correction loop be demonstrated even without Docker installed.
 */
export async function buildAndRunSimulated(dir, dockerfileContent, codebaseInfo, logCallback) {
  logCallback('System', 'Starting SIMULATED Docker Build Engine...');
  await new Promise((r) => setTimeout(r, 1000));

  const lines = dockerfileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  let currentStep = 1;
  const totalSteps = lines.filter(l => /^(FROM|WORKDIR|COPY|RUN|EXPOSE|CMD|ENV|ADD|ENTRYPOINT)/i.test(l)).length;

  let copiedFiles = new Set();
  let baseImage = '';
  let workingDir = '/';
  
  // Search codebaseInfo to see what files exist in the project
  const filesInRepo = new Set();
  if (codebaseInfo && codebaseInfo.configFiles) {
    codebaseInfo.configFiles.forEach(f => {
      filesInRepo.add(f.name);
      // Also add folder paths
      const parts = f.name.split('/');
      for (let i = 1; i <= parts.length; i++) {
        filesInRepo.add(parts.slice(0, i).join('/'));
      }
    });
  }

  // Also heuristically add some generic files if tree has them
  if (codebaseInfo && codebaseInfo.tree) {
    const matches = codebaseInfo.tree.match(/📄\s+([^\s\n\/]+)/g);
    if (matches) {
      matches.forEach(m => filesInRepo.add(m.replace('📄', '').trim()));
    }
  }

  logCallback('Simulator', `Scanning repo workspace context... Detected ${filesInRepo.size} project files.`);

  for (const line of lines) {
    if (/^\s*#/i.test(line)) continue; // Skip comments

    const match = line.match(/^([A-Z]+)\s+(.*)$/);
    if (!match) continue;

    const command = match[1];
    const args = match[2];

    logCallback('Docker Build', `Step ${currentStep}/${totalSteps} : ${command} ${args}`);
    await new Promise((r) => setTimeout(r, 800));

    if (command === 'FROM') {
      baseImage = args.toLowerCase();
      logCallback('Docker Build', `---> Pulling library/${baseImage} from docker.io...`);
      await new Promise((r) => setTimeout(r, 800));
      logCallback('Docker Build', `---> Digest: sha256:8b0e774dfd8f583e762c2f42a5cb8b7764f6932488a03282b0e785b98585ff6e`);
      logCallback('Docker Build', `---> Status: Downloaded newer image for ${baseImage}`);
    } 
    else if (command === 'WORKDIR') {
      workingDir = args;
      logCallback('Docker Build', `---> Running in 3f5d81bfa6bc`);
      logCallback('Docker Build', `---> Removing intermediate container 3f5d81bfa6bc`);
      logCallback('Docker Build', `---> bd015ffea3c8`);
    } 
    else if (command === 'COPY') {
      logCallback('Docker Build', `---> Running in fd7e31b67272`);
      
      // Parse COPY syntax: COPY <src> <dest>
      const parts = args.split(/\s+/);
      const src = parts[0];
      const dest = parts[1];

      // Simulate copying files
      if (src === '.' || src === './') {
        // Copied everything
        filesInRepo.forEach(f => copiedFiles.add(f));
        logCallback('Docker Build', `---> Copied all files into ${workingDir}`);
      } else {
        // Specific file or glob, like package*.json
        if (src.includes('*')) {
          const prefix = src.split('*')[0];
          let foundAny = false;
          filesInRepo.forEach(f => {
            if (f.startsWith(prefix)) {
              copiedFiles.add(f);
              foundAny = true;
              logCallback('Docker Build', `---> Copying file: ${f} to ${workingDir}`);
            }
          });
          if (!foundAny) {
            logCallback('Docker Build', `WARNING: COPY ${src} did not match any files.`);
          }
        } else {
          // Normal file copy
          const cleanSrc = src.replace(/^\.\//, '');
          if (filesInRepo.has(cleanSrc)) {
            copiedFiles.add(cleanSrc);
            logCallback('Docker Build', `---> Copying file: ${cleanSrc} to ${workingDir}`);
          } else {
            // Error! File not found in workspace to copy
            const errMsg = `COPY failed: file not found in build context: ${src}`;
            logCallback('Docker Build', `ERROR: ${errMsg}`);
            throw new Error(errMsg);
          }
        }
      }
      logCallback('Docker Build', `---> Removing intermediate container fd7e31b67272`);
      logCallback('Docker Build', `---> 51fb7892af2d`);
    } 
    else if (command === 'RUN') {
      logCallback('Docker Build', `---> Running in b726a8fe55d3`);
      
      const runCommand = args.trim();

      // Heuristic validation: Node package manager install
      if (runCommand.includes('npm install') || runCommand.includes('npm ci') || runCommand.includes('yarn install')) {
        // Validate base image is node-friendly
        if (!baseImage.includes('node') && !baseImage.includes('alpine') && !baseImage.includes('ubuntu') && !baseImage.includes('debian')) {
          const errMsg = `/bin/sh: 1: ${runCommand.split(' ')[0]}: not found`;
          logCallback('Docker Build', `stderr: ${errMsg}`);
          logCallback('Docker Build', `ERROR: Build failed due to command execution error.`);
          throw new Error(errMsg);
        }

        // Validate package.json is copied! (A VERY common mistake that we want to self-correct!)
        const hasPackageJson = [...copiedFiles].some(f => f.endsWith('package.json'));
        if (!hasPackageJson) {
          const errMsg = `npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path ${workingDir}/package.json\nnpm ERR! errno -2\nnpm ERR! enoent ENOENT: no such file or directory, open '${workingDir}/package.json'\nnpm ERR! enoent This is related to npm not being able to find a file.`;
          logCallback('Docker Build', `stderr: ${errMsg}`);
          logCallback('Docker Build', `ERROR: Build failed with exit code 254`);
          throw new Error(errMsg);
        }

        logCallback('Docker Build', `npm run: installing dependencies...`);
        // Simulate dependency installations
        await new Promise((r) => setTimeout(r, 1000));
        logCallback('Docker Build', `added 241 packages, and audited 242 packages in 12s`);
      }
      // Heuristic validation: Python pip install
      else if (runCommand.includes('pip install')) {
        if (!baseImage.includes('python') && !baseImage.includes('alpine') && !baseImage.includes('ubuntu')) {
          const errMsg = `/bin/sh: 1: pip: not found`;
          logCallback('Docker Build', `stderr: ${errMsg}`);
          throw new Error(errMsg);
        }

        if (runCommand.includes('-r requirements.txt') && !copiedFiles.has('requirements.txt')) {
          const errMsg = `ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'`;
          logCallback('Docker Build', `stderr: ${errMsg}`);
          throw new Error(errMsg);
        }

        logCallback('Docker Build', `pip: Installing packages from requirements.txt...`);
        await new Promise((r) => setTimeout(r, 1000));
        logCallback('Docker Build', `Successfully installed dependencies.`);
      }
      else {
        // Generic RUN command
        logCallback('Docker Build', `Executing: ${runCommand}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      logCallback('Docker Build', `---> Removing intermediate container b726a8fe55d3`);
      logCallback('Docker Build', `---> a6c8ef81da53`);
    }

    currentStep++;
  }

  logCallback('Docker Build', `Successfully built image dockerforge-simulated:latest`);
  
  // Simulate Running
  logCallback('System', `Spawning SIMULATED container on port 8000 (Host: 3000)...`);
  await new Promise((r) => setTimeout(r, 1200));

  // Find CMD or ENTRYPOINT
  const cmdLine = lines.find(l => /^CMD/i.test(l));
  if (!cmdLine) {
    const errMsg = `Error: No CMD or ENTRYPOINT specified. Container will exit immediately.`;
    logCallback('Container Start', errMsg);
    throw new Error(errMsg);
  }

  const cmdArgs = cmdLine.replace(/^CMD\s+/i, '').trim();
  logCallback('System', `Executing command: ${cmdArgs}`);

  // Let's validate the run command!
  // If Node.js `npm start` or `npm run start` is executed, we check if package.json has a start script!
  if (cmdArgs.includes('npm start') || cmdArgs.includes('npm run start') || cmdArgs.includes('"npm", "start"') || cmdArgs.includes('"npm", "run", "start"')) {
    // Read package.json content from codebaseInfo if it exists
    const pkgJsonFile = codebaseInfo.configFiles.find(f => f.name.endsWith('package.json'));
    if (pkgJsonFile) {
      try {
        const pkgData = JSON.parse(pkgJsonFile.content);
        if (!pkgData.scripts || !pkgData.scripts.start) {
          const errMsg = `npm ERR! missing script: start\n\nnpm ERR! A complete log of this run can be found in:\nnpm ERR!     /root/.npm/_logs/2026-05-26T00_15_00_123Z-debug-0.log`;
          logCallback('Container Output', errMsg);
          logCallback('System', `Container crashed with exit code 1`);
          throw new Error(`Container start command failed: ${errMsg}`);
        }
      } catch (e) {
        if (e.message.startsWith('Container start command')) throw e;
        // If JSON fails to parse, treat it as a script error
        const errMsg = `npm ERR! Failed to parse package.json: unexpected token`;
        logCallback('Container Output', errMsg);
        throw new Error(errMsg);
      }
    }
  }

  // If start command is successful, stream logs!
  logCallback('Container Output', `> app@1.0.0 start`);
  logCallback('Container Output', `> node server.js`);
  await new Promise((r) => setTimeout(r, 500));
  logCallback('Container Output', `Server starting on port 3000...`);
  logCallback('Container Output', `Database connected successfully!`);
  logCallback('Container Output', `Application initialized and listening.`);
  
  await new Promise((r) => setTimeout(r, 1000));
  logCallback('System', `Pinging container health endpoint...`);
  logCallback('System', `Success! GET / - 200 OK (24ms)`);
  logCallback('System', `Verification successful! Simulated container is fully responsive.`);

  return { success: true, logs: 'Simulated build and run completed successfully.' };
}
