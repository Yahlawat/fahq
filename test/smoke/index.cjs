'use strict';

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('yashahlawat.fahq');
  assert.ok(extension, 'Fahq is installed from the VSIX');
  await extension.activate();
  assert.equal(vscode.workspace.getConfiguration('fahq').get('enabled'), false);
  assert.ok((await vscode.commands.getCommands()).includes('fahq.test'));
  const tone = join(extension.extensionPath, 'media', 'fahq.wav');
  assert.ok(existsSync(tone));
  if (process.platform === 'win32') {
    // A hosted runner may have no audio device. Exercise the actual Windows WAV decoder.
    const script = "$ErrorActionPreference = 'Stop'; $sound = [System.Media.SoundPlayer]::new($env:FAHQ_AUDIO_FILE); try { $sound.Load() } finally { $sound.Dispose() }";
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, FAHQ_AUDIO_FILE: tone },
      timeout: 15_000,
      windowsHide: true,
    });
  }
};
