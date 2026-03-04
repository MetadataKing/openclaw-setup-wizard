#!/usr/bin/env node

/**
 * OpenClaw Setup Wizard v1.0.2
 * Fully automated. Zero questions. Detects, configures, installs, launches.
 *
 * npx openclaw-setup-wizard                    # Auto everything
 * npx openclaw-setup-wizard --telegram TOKEN   # Auto + Telegram
 * npx openclaw-setup-wizard --discord TOKEN    # Auto + Discord
 * npx openclaw-setup-wizard --model qwen3:8b   # Override model
 * npx openclaw-setup-wizard --no-launch        # Setup only
 */

import { writeFile, mkdir, copyFile } from 'fs/promises';
import { execSync, spawn } from 'child_process';
import { homedir, platform, totalmem } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

const IS_WIN = platform() === 'win32';
const HOME = homedir();
const CONFIG_DIR = join(HOME, '.openclaw');
const CONFIG_PATH = join(CONFIG_DIR, 'openclaw.json');
const args = process.argv.slice(2);

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' }).trim(); }
  catch { return null; }
}

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function hasFlag(flag) { return args.includes(flag); }

function generateToken() {
  return Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join('');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function detectGPU() {
  var smi = run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
  if (smi) {
    var parts = smi.split('\n')[0].split(',').map(s => s.trim());
    return { name: parts[0], vram: parseInt(parts[1]), type: 'nvidia' };
  }
  if (platform() === 'darwin') {
    var brand = run('sysctl -n machdep.cpu.brand_string 2>/dev/null');
    if (brand && brand.includes('Apple')) {
      var memBytes = parseInt(run('sysctl -n hw.memsize 2>/dev/null') || '0');
      var gb = Math.round(memBytes / 1024 / 1024 / 1024);
      return { name: brand, vram: Math.round(gb * 0.75 * 1024), type: 'apple' };
    }
  }
  return null;
}

var MODELS = [
  { id: 'qwen2.5:3b',     vram: 2500,  priority: 3,  tools: true  },
  { id: 'qwen2.5:7b',     vram: 5000,  priority: 8,  tools: true  },
  { id: 'qwen3:8b',       vram: 5500,  priority: 9,  tools: true  },
  { id: 'qwen2.5:14b',    vram: 9500,  priority: 7,  tools: true  },
  { id: 'qwen2.5:32b',    vram: 20000, priority: 6,  tools: true  },
  { id: 'deepseek-r1:7b', vram: 5000,  priority: 5,  tools: false },
  { id: 'llama3.1:8b',    vram: 5500,  priority: 4,  tools: true  },
  { id: 'mistral:7b',     vram: 5000,  priority: 2,  tools: true  },
  { id: 'phi3:3.8b',      vram: 3000,  priority: 1,  tools: false },
];

function pickBestModels(vramMB, installedIds) {
  if (vramMB <= 0) vramMB = 4000;
  var installedKnown = MODELS.filter(function(m) {
    return installedIds.some(function(i) { return i.includes(m.id); });
  });
  var installedFits = installedKnown
    .filter(function(m) { return m.vram <= vramMB * 0.85; })
    .sort(function(a, b) { return b.priority - a.priority; });
  if (installedFits.length > 0) {
    var primary = installedFits.find(function(m) { return m.tools; }) || installedFits[0];
    var secondary = installedFits.find(function(m) { return m.id !== primary.id; });
    return { models: secondary ? [primary, secondary] : [primary], fromInstalled: true };
  }
  if (installedIds.length > 0) {
    return { models: [{ id: installedIds[0], vram: 0, priority: 10, tools: true }], fromInstalled: true };
  }
  var fits = MODELS
    .filter(function(m) { return m.vram <= vramMB * 0.85; })
    .sort(function(a, b) { return b.priority - a.priority; });
  if (fits.length === 0) return { models: [MODELS[0]], fromInstalled: false };
  var primary2 = fits.find(function(m) { return m.tools; }) || fits[0];
  var remaining = vramMB - primary2.vram;
  var secondary2 = fits.find(function(m) {
    return m.id !== primary2.id && m.id.includes('deepseek') && m.vram <= remaining;
  });
  return { models: secondary2 ? [primary2, secondary2] : [primary2], fromInstalled: false };
}

function getInstalledModels() {
  var list = run('ollama list');
  if (!list) return [];
  return list.split('\n').slice(1).filter(function(l) { return l.trim(); }).map(function(l) { return l.split(/\s+/)[0]; });
}

async function waitForOllama(maxSeconds) {
  if (!maxSeconds) maxSeconds = 30;
  for (var i = 0; i < maxSeconds; i++) {
    if (run('curl -s http://127.0.0.1:11434/api/tags')) return true;
    await sleep(1000);
    if (i % 5 === 4) console.log('  ' + c.dim('  waiting... ' + (i + 1) + 's'));
  }
  return false;
}

async function main() {
  console.log(c.bold('\n  🦞 ' + c.cyan('OpenClaw Setup Wizard') + ' v1.0.2'));
  console.log(c.dim('  Fully automated — sit back and watch.\n'));
  var startTime = Date.now();

  // ─── Hardware ───
  console.log(c.bold('  ━━━ Hardware ━━━'));
  var gpu = detectGPU();
  var ramGB = Math.round(totalmem() / 1024 / 1024 / 1024);
  var vram = gpu ? gpu.vram : 0;
  if (gpu) {
    console.log('  ' + c.green('✓') + ' GPU: ' + c.bold(gpu.name));
    console.log('  ' + c.green('✓') + ' VRAM: ' + c.bold((vram / 1024).toFixed(0) + 'GB'));
  } else {
    console.log('  ' + c.yellow('⚠') + ' No GPU detected — CPU mode');
  }
  console.log('  ' + c.green('✓') + ' RAM: ' + c.bold(ramGB + 'GB'));
  console.log('  ' + c.green('✓') + ' OS: ' + c.bold(IS_WIN ? 'Windows' : platform() === 'darwin' ? 'macOS' : 'Linux'));

  // ─── Ollama ───
  console.log('\n' + c.bold('  ━━━ Ollama ━━━'));
  var ollamaVersion = run('ollama --version');
  if (!ollamaVersion) {
    console.log('  ' + c.red('✗') + ' Ollama not installed');
    if (IS_WIN) {
      console.log('  ' + c.cyan('⏳') + ' Installing via winget...');
      try {
        execSync('winget install --id Ollama.Ollama --accept-package-agreements --accept-source-agreements', { stdio: 'inherit', timeout: 120000 });
        ollamaVersion = 'just installed';
      } catch(e) {
        console.log('  ' + c.red('✗') + ' Failed. Download: ' + c.cyan('https://ollama.ai'));
        process.exit(1);
      }
    } else if (platform() === 'linux') {
      try {
        execSync('curl -fsSL https://ollama.ai/install.sh | sh', { stdio: 'inherit', timeout: 120000 });
        ollamaVersion = 'just installed';
      } catch(e) {
        console.log('  ' + c.red('✗') + ' Failed. Run: curl -fsSL https://ollama.ai/install.sh | sh');
        process.exit(1);
      }
    } else {
      console.log('  ' + c.yellow('→') + ' Install from: ' + c.cyan('https://ollama.ai'));
      process.exit(1);
    }
  } else {
    var clean = ollamaVersion.replace(/Warning:.*\n?/g, '').trim();
    console.log('  ' + c.green('✓') + ' Installed' + (clean ? ': ' + clean : ''));
  }

  var apiUp = !!run('curl -s http://127.0.0.1:11434/api/tags');
  if (!apiUp) {
    console.log('  ' + c.cyan('⏳') + ' Starting Ollama (up to 30s)...');
    try {
      var child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', function() {});
      child.unref();
    } catch(e) {}
    apiUp = await waitForOllama(30);
    console.log(apiUp ? '  ' + c.green('✓') + ' Ollama running' : '  ' + c.yellow('⚠') + ' Ollama slow — will retry');
  } else {
    console.log('  ' + c.green('✓') + ' API responding');
  }

  // ─── Model Selection ───
  console.log('\n' + c.bold('  ━━━ Model Selection ━━━'));
  var installed = getInstalledModels();
  if (installed.length > 0) {
    console.log('  ' + c.green('✓') + ' Found ' + installed.length + ' installed model' + (installed.length !== 1 ? 's' : '') + ':');
    installed.forEach(function(m) { console.log('    ' + c.dim('·') + ' ' + m); });
  }

  var overrideModel = getArg('--model');
  var selectedModels, primaryModel, needsPull;
  if (overrideModel) {
    selectedModels = [{ id: overrideModel }];
    primaryModel = overrideModel;
    needsPull = !installed.some(function(m) { return m.includes(overrideModel); });
    console.log('  ' + c.green('✓') + ' Override: ' + c.bold(primaryModel));
  } else {
    var pick = pickBestModels(vram, installed);
    selectedModels = pick.models;
    primaryModel = selectedModels[0].id;
    needsPull = !pick.fromInstalled;
    if (pick.fromInstalled) {
      console.log('  ' + c.green('✓') + ' Using installed:');
    } else {
      console.log('  ' + c.green('✓') + ' Best for ' + (vram > 0 ? (vram / 1024).toFixed(0) + 'GB' : 'CPU') + ':');
    }
    selectedModels.forEach(function(m, i) {
      var icon = i === 0 ? c.cyan('★') : c.dim('·');
      var label = i === 0 ? c.cyan('(primary)') : c.dim('(secondary)');
      console.log('    ' + icon + ' ' + c.bold(m.id) + ' ' + label);
    });
  }

  // ─── Pull (only if needed) ───
  if (needsPull) {
    console.log('\n' + c.bold('  ━━━ Pulling Models ━━━'));
    if (!apiUp) {
      console.log('  ' + c.cyan('⏳') + ' Waiting for Ollama...');
      apiUp = await waitForOllama(30);
      if (!apiUp) { console.log('  ' + c.red('✗') + ' Ollama not responding.'); process.exit(1); }
    }
    for (var mi = 0; mi < selectedModels.length; mi++) {
      var model = selectedModels[mi];
      var alreadyHave = installed.some(function(m) { return m.includes(model.id); });
      if (alreadyHave) {
        console.log('  ' + c.green('✓') + ' ' + model.id + ' already installed');
      } else {
        console.log('  ' + c.cyan('⏳') + ' Pulling ' + model.id + '...');
        try {
          execSync('ollama pull ' + model.id, { stdio: 'inherit', timeout: 1800000 });
          console.log('  ' + c.green('✓') + ' ' + model.id + ' ready');
        } catch(e) {
          console.log('  ' + c.yellow('⚠') + ' Failed — run later: ollama pull ' + model.id);
        }
      }
    }
  } else {
    console.log('\n  ' + c.green('✓') + ' All models installed — skipping pull');
  }

  // ─── Config ───
  console.log('\n' + c.bold('  ━━━ Configuration ━━━'));
  var gatewayToken = generateToken();
  var config = {
    models: {
      providers: {
        ollama: {
          api: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          models: selectedModels.map(function(m) { return { id: m.id, name: m.id }; }),
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: 'ollama/' + primaryModel },
        sandbox: { mode: 'off' },
      },
    },
    tools: { deny: ['browser'] },
    gateway: {
      mode: 'local',
      port: 18789,
      auth: { token: gatewayToken },
    },
  };

  var telegramToken = getArg('--telegram');
  if (telegramToken) {
    config.channels = { telegram: { botToken: telegramToken, dmPolicy: 'pairing' } };
    try {
      var tgUrl = 'https://api.telegram.org/bot' + telegramToken + '/getMe';
      var check = run('curl -s "' + tgUrl + '"');
      var data = JSON.parse(check);
      if (data.ok) console.log('  ' + c.green('✓') + ' Telegram: @' + data.result.username);
    } catch(e) {}
    var whUrl = 'https://api.telegram.org/bot' + telegramToken + '/deleteWebhook?drop_pending_updates=true';
    run('curl -s "' + whUrl + '"');
  }
  var discordToken = getArg('--discord');
  if (discordToken) {
    if (!config.channels) config.channels = {};
    config.channels.discord = { botToken: discordToken };
    console.log('  ' + c.green('✓') + ' Discord configured');
  }

  await mkdir(CONFIG_DIR, { recursive: true });
  if (existsSync(CONFIG_PATH)) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(CONFIG_PATH, CONFIG_PATH.replace('.json', '.backup-' + ts + '.json'));
    console.log('  ' + c.yellow('📦') + ' Backed up existing config');
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('  ' + c.green('✓') + ' Saved: ' + c.dim(CONFIG_PATH));
  console.log('  ' + c.green('✓') + ' Gateway: ' + c.cyan('local') + ' mode, port ' + c.cyan('18789'));
  console.log('  ' + c.green('✓') + ' Token: ' + c.dim(gatewayToken.slice(0, 8) + '...'));

  // ─── Warm Up ───
  console.log('\n' + c.bold('  ━━━ Loading Model ━━━'));
  console.log('  ' + c.cyan('⏳') + ' Warming ' + primaryModel + '...');
  try {
    execSync('ollama run ' + primaryModel + ' --keepalive 24h "hello"', { timeout: 120000, stdio: 'pipe' });
    console.log('  ' + c.green('✓') + ' ' + primaryModel + ' loaded (24h keepalive)');
  } catch(e) {
    console.log('  ' + c.yellow('⚠') + ' Will load on first use');
  }

  // ─── Kill Old Gateways ───
  if (IS_WIN) {
    var portCheck = run('netstat -ano | findstr 18789');
    if (portCheck) {
      var lines = portCheck.split('\n').filter(function(l) { return l.includes('LISTENING'); });
      var pids = [];
      lines.forEach(function(l) {
        var pid = l.trim().split(/\s+/).pop();
        if (pids.indexOf(pid) === -1) pids.push(pid);
      });
      if (pids.length > 0) {
        console.log('\n' + c.bold('  ━━━ Cleanup ━━━'));
        pids.forEach(function(pid) {
          run('taskkill /PID ' + pid + ' /F');
          console.log('  ' + c.green('✓') + ' Killed old PID ' + pid);
        });
      }
    }
  } else {
    var pidList = run('lsof -ti:18789');
    if (pidList) {
      console.log('\n' + c.bold('  ━━━ Cleanup ━━━'));
      pidList.split('\n').forEach(function(p) {
        if (p.trim()) run('kill -9 ' + p.trim());
      });
    }
  }

  // ─── Diagnostics ───
  console.log('\n' + c.bold('  ━━━ Diagnostics ━━━'));
  var ranDiag = false;
  var doctorGlobal = run(IS_WIN ? 'where openclaw-doctor 2>nul' : 'which openclaw-doctor 2>/dev/null');
  if (doctorGlobal) {
    try { execSync('openclaw-doctor', { stdio: 'inherit', timeout: 30000 }); ranDiag = true; } catch(e) {}
  }
  if (!ranDiag) {
    var localPaths = [
      join('D:', 'MetadataKingdom', 'openclaw-doctor-pro', 'src', 'index.js'),
      join(HOME, 'openclaw-doctor-pro', 'src', 'index.js'),
    ];
    for (var pi = 0; pi < localPaths.length; pi++) {
      if (existsSync(localPaths[pi])) {
        try {
          execSync('node "' + localPaths[pi] + '"', { stdio: 'inherit', timeout: 30000 });
          ranDiag = true;
          break;
        } catch(e) {}
      }
    }
  }
  if (!ranDiag) {
    console.log('  ' + c.dim('Tip: npm i -g openclaw-doctor-pro for diagnostics'));
  }

  // ─── Done ───
  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + c.bold('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log('  ' + c.green('🦞') + ' ' + c.bold('OpenClaw ready!') + ' ' + c.dim('(' + elapsed + 's)'));
  console.log(c.bold('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━') + '\n');
  console.log('  GPU:     ' + (gpu ? c.cyan(gpu.name) : c.yellow('CPU')));
  console.log('  Model:   ' + c.cyan(primaryModel));
  console.log('  Gateway: ' + c.cyan('http://127.0.0.1:18789'));
  if (telegramToken) console.log('  Chat:    ' + c.cyan('Telegram'));
  if (discordToken) console.log('  Chat:    ' + c.cyan('Discord'));
  console.log('');

  if (hasFlag('--no-launch')) {
    console.log('  ' + c.dim('Start later:') + ' ' + c.cyan('openclaw gateway') + '\n');
    process.exit(0);
  }

  console.log('  ' + c.cyan('⚡') + ' Launching gateway...\n');
  try { execSync('openclaw gateway', { stdio: 'inherit' }); }
  catch(e) { console.log('\n  ' + c.yellow('⚠') + ' Gateway exited. Run: ' + c.cyan('openclaw gateway')); }
}

main().catch(function(e) { console.error('\n  ' + c.red('Error:') + ' ' + e.message); process.exit(1); });
