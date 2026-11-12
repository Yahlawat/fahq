// fahq: plays a sound when the error count in the file you're editing goes up,
// or when a terminal command or notebook cell fails.
// Plain JS with no dependencies, so there's no build step.
const vscode = require('vscode');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { playbackCommand } = require('./audio');

// Only react to files edited this recently, so opening a broken file stays quiet.
const RECENT_EDIT_MS = 15000;
// Exit code when you cancel a command with Ctrl+C. Not a mistake, so it stays quiet.
const CTRL_C_EXIT = 130;

let settled = new Map();   // uri -> error count at the last check
let lastEdit = new Map();  // uri -> time of last edit
let timers = new Map();    // uri -> pending settle timer
let lastPlayed = 0;
let player = null;
let statusItem;
let bundledSound;

function config() {
  return vscode.workspace.getConfiguration('fahq');
}

function countProblems(uri) {
  const maxSeverity = config().get('includeWarnings')
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
  return vscode.languages.getDiagnostics(uri).filter(d => d.severity <= maxSeverity).length;
}

function soundFile() {
  const custom = config().get('soundPath');
  if (custom && fs.existsSync(custom)) return custom;
  return bundledSound;
}

function play() {
  const file = soundFile();
  if (player) player.kill();

  const { command, args, env } = playbackCommand(process.platform, file, config().get('volume'));
  const playback = spawn(command, args, { env, stdio: 'ignore', windowsHide: true });
  player = playback;
  playback.on('error', error => console.warn('fahq could not start audio playback:', error.message));
  playback.on('close', (code, signal) => {
    if (player === playback) player = null;
    if (code && !signal) console.warn(`fahq audio player exited with code ${code}.`);
  });
}

function check(uri) {
  const key = uri.toString();
  timers.delete(key);

  const count = countProblems(uri);
  const before = settled.get(key) ?? count;
  settled.set(key, count);

  const editedRecently = Date.now() - (lastEdit.get(key) ?? 0) < RECENT_EDIT_MS;
  if (editedRecently && count > before) trigger();
}

function trigger() {
  if (!config().get('enabled')) return;
  if (Date.now() - lastPlayed <= config().get('cooldownMs')) return;
  lastPlayed = Date.now();
  play();
}

// Needs shell integration, which VS Code turns on by default for zsh, bash, fish and PowerShell.
function onCommandEnd(e) {
  if (!config().get('terminal')) return;
  const code = e.exitCode;
  if (code === undefined || code === 0 || code === CTRL_C_EXIT) return;
  trigger();
}

// A notebook cell finished running with an error (a traceback). Interrupting the kernel
// also counts as a failure, so KeyboardInterrupt is skipped like Ctrl+C in the terminal.
function onNotebookChange(e) {
  if (!config().get('notebook')) return;
  for (const change of e.cellChanges) {
    if (change.executionSummary?.success !== false) continue;
    const interrupted = change.cell.outputs.some(o => o.items.some(item =>
      item.mime === 'application/vnd.code.notebook.error' &&
      /KeyboardInterrupt/.test(Buffer.from(item.data).toString())));
    if (!interrupted) trigger();
  }
}

function onDiagnostics(e) {
  const active = vscode.window.activeTextEditor?.document.uri.toString();
  for (const uri of e.uris) {
    const key = uri.toString();
    if (key !== active) {
      // Keep a baseline for other files so switching to them later doesn't trigger.
      settled.set(key, countProblems(uri));
      continue;
    }
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => check(uri), config().get('settleMs')));
  }
}

function updateStatus() {
  const on = config().get('enabled');
  statusItem.text = on ? '$(unmute) fahq' : '$(mute) fahq';
  statusItem.tooltip = on ? 'fahq is on. Click to mute.' : 'fahq is muted. Click to turn on.';
}

function activate(context) {
  bundledSound = path.join(context.extensionPath, 'media', 'fahq.wav');

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'fahq.toggle';
  updateStatus();
  statusItem.show();

  // Baseline whatever is already broken so it doesn't count as new.
  for (const [uri] of vscode.languages.getDiagnostics()) {
    settled.set(uri.toString(), countProblems(uri));
  }

  context.subscriptions.push(
    statusItem,
    vscode.languages.onDidChangeDiagnostics(onDiagnostics),
    vscode.window.onDidEndTerminalShellExecution(onCommandEnd),
    vscode.workspace.onDidChangeNotebookDocument(onNotebookChange),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.contentChanges.length) lastEdit.set(e.document.uri.toString(), Date.now());
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('fahq.enabled')) updateStatus();
    }),
    vscode.commands.registerCommand('fahq.toggle', () =>
      config().update('enabled', !config().get('enabled'), vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('fahq.test', play),
    vscode.commands.registerCommand('fahq.chooseSound', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Use this sound',
        filters: { Audio: ['wav', 'mp3', 'aiff', 'm4a', 'ogg'] },
      });
      if (!picked) return;
      await config().update('soundPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
      play();
    }),
    vscode.commands.registerCommand('fahq.resetSound', () =>
      config().update('soundPath', '', vscode.ConfigurationTarget.Global)),
    { dispose: () => { timers.forEach(clearTimeout); if (player) player.kill(); } },
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
