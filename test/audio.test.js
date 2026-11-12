'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { playbackCommand } = require('../src/audio');

test('the bundled tone is a PCM WAV', () => {
  const wave = readFileSync(join(__dirname, '../media/fahq.wav'));
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wave.readUInt16LE(20), 1);
  assert.equal(wave.readUInt16LE(34), 16);
});

test('custom paths are passed as data on both platforms', () => {
  const macPath = "/Users/someone/My Sounds/That's it.wav";
  const windowsPath = String.raw`C:\Users\someone\My Sounds\That's it.wav`;
  assert.deepEqual(playbackCommand('darwin', macPath, 0.5).args, ['-v', '0.5', macPath]);
  const windows = playbackCommand('win32', windowsPath, 1);
  assert.equal(windows.command, 'powershell.exe');
  assert.equal(windows.env.FAHQ_AUDIO_FILE, windowsPath);
  const script = Buffer.from(windows.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /\$env:FAHQ_AUDIO_FILE/);
  assert.doesNotMatch(script, /That's it/);
});
