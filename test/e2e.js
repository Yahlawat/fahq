// End-to-end check, run inside a real VS Code by test/run.sh.
// A fake linter (a diagnostic collection we control) reports errors the same way a
// language server does; we watch for the afplay process to see whether fahq fired.
const vscode = require('vscode');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function playing() {
  try { execSync('pgrep -f "afplay.*fahq.wav"'); return true; } catch { return false; }
}

// Waits out any sound already playing so it isn't mistaken for a new one.
async function playsWithin(ms) {
  while (playing()) await sleep(100);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (playing()) return true;
    await sleep(100);
  }
  return false;
}

exports.run = async () => {
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  try {
    const report = await main(ws);
    fs.writeFileSync(path.join(ws, 'results.txt'), report.text + '\n');
    if (!report.ok) throw new Error('fahq e2e failed');
  } catch (e) {
    if (!fs.existsSync(path.join(ws, 'results.txt'))) {
      fs.writeFileSync(path.join(ws, 'results.txt'), 'ERROR  ' + e.stack + '\n');
    }
    throw e;
  }
};

async function main(ws) {
  const results = [];
  const expect = (name, got, want) => results.push(`${got === want ? 'PASS' : 'FAIL'}  ${name}`);

  const doc = await vscode.workspace.openTextDocument(path.join(ws, 'code.txt'));
  const editor = await vscode.window.showTextDocument(doc);
  const lint = vscode.languages.createDiagnosticCollection('fake-linter');
  const report = n => lint.set(doc.uri, Array.from({ length: n }, (_, i) =>
    new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), `error ${i}`, vscode.DiagnosticSeverity.Error)));
  const type = text => editor.edit(e => e.insert(new vscode.Position(doc.lineCount, 0), text));

  report(1);
  expect('existing error, no edits: quiet', await playsWithin(3000), false);

  await type('let y = ;\n');
  report(2);
  expect('edit adds an error: plays', await playsWithin(3000), true);
  await sleep(4000); // let the sound finish and the cooldown pass

  await type('x');
  report(1);
  expect('edit fixes an error: quiet', await playsWithin(3000), false);

  await type('pri');
  report(2);
  await sleep(300);
  await type('nt');
  report(1);
  expect('error gone before settling (half-typed word): quiet', await playsWithin(3000), false);

  report(0);
  await sleep(1500);
  await type('a');
  report(1);
  expect('warning-free file gets its first error: plays', await playsWithin(3000), true);
  await sleep(4000);

  await type('b');
  report(2);
  expect('another new error after the cooldown: plays', await playsWithin(3000), true);

  const fahq = vscode.workspace.getConfiguration('fahq');
  await fahq.update('cooldownMs', 30000, vscode.ConfigurationTarget.Global);
  await type('d');
  report(3);
  expect('another error within the cooldown: quiet', await playsWithin(3000), false);
  await fahq.update('cooldownMs', undefined, vscode.ConfigurationTarget.Global);
  await sleep(1500);

  await vscode.commands.executeCommand('fahq.toggle');
  await type('e');
  report(4);
  expect('muted: quiet', await playsWithin(3000), false);
  await vscode.commands.executeCommand('fahq.toggle');

  // Notebook: a fake kernel whose cells pass or raise whatever we tell them to.
  const nbPath = path.join(ws, 'nb.ipynb');
  fs.writeFileSync(nbPath, JSON.stringify({
    cells: [{ cell_type: 'code', source: ['x = 1\n'], metadata: {}, outputs: [], execution_count: null }],
    metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
    nbformat: 4, nbformat_minor: 5,
  }));
  let raise = null; // null = cell succeeds, otherwise the exception name
  const kernel = vscode.notebooks.createNotebookController('fahq-test-kernel', 'jupyter-notebook', 'fahq test kernel');
  kernel.supportedLanguages = ['python'];
  kernel.executeHandler = async cells => {
    for (const cell of cells) {
      const run = kernel.createNotebookCellExecution(cell);
      run.start(Date.now());
      if (raise) {
        const err = new Error('boom');
        err.name = raise;
        await run.replaceOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(err)]));
      }
      run.end(!raise, Date.now());
    }
  };
  const nb = await vscode.workspace.openNotebookDocument(vscode.Uri.file(nbPath));
  const nbEditor = await vscode.window.showNotebookDocument(nb);
  await vscode.commands.executeCommand('notebook.selectKernel',
    { notebookEditor: nbEditor, id: kernel.id, extension: 'yashahlawat.fahq' });
  const runCell = what => { raise = what; return kernel.executeHandler([nb.cellAt(0)], nb, kernel); };

  await sleep(2500); // cooldown from the editor tests
  await runCell(null);
  expect('notebook: cell runs fine: quiet', await playsWithin(3000), false);

  await runCell('ValueError');
  expect('notebook: cell raises an exception: plays', await playsWithin(3000), true);
  await sleep(3000);

  await runCell('KeyboardInterrupt');
  expect('notebook: kernel interrupted: quiet', await playsWithin(3000), false);

  await runCell('KeyError');
  expect('notebook: same cell fails again: plays', await playsWithin(3000), true);
  await sleep(3000);

  nbEditor.selections = [new vscode.NotebookRange(0, 1)];
  await vscode.commands.executeCommand('notebook.cell.edit');
  await sleep(500);
  const cellEditor = vscode.window.activeTextEditor;
  const cellDoc = nb.cellAt(0).document;
  if (cellEditor?.document !== cellDoc) {
    results.push('FAIL  notebook: could not focus the cell editor');
  } else {
    lint.set(cellDoc.uri, []);
    await sleep(1500);
    await cellEditor.edit(e => e.insert(new vscode.Position(0, 0), 'print(\n'));
    lint.set(cellDoc.uri, [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 6), '"(" was not closed', vscode.DiagnosticSeverity.Error)]);
    expect('notebook: typing an error into a cell: plays', await playsWithin(3000), true);
  }
  kernel.dispose();
  lint.dispose();
  await sleep(3000);

  const term = vscode.window.createTerminal({ name: 'fahq-test' });
  term.show();
  const shell = term.shellIntegration ?? await new Promise(resolve => {
    const sub = vscode.window.onDidChangeTerminalShellIntegration(e => {
      if (e.terminal === term) { sub.dispose(); resolve(e.shellIntegration); }
    });
    setTimeout(() => { sub.dispose(); resolve(undefined); }, 20000);
  });
  if (!shell) {
    results.push('FAIL  terminal shell integration never started');
  } else {
    await sleep(3500); // cooldown from the editor tests
    shell.executeCommand('true');
    expect('terminal: command succeeds: quiet', await playsWithin(3000), false);

    shell.executeCommand('false');
    expect('terminal: command fails: plays', await playsWithin(3000), true);
    await sleep(4000);

    shell.executeCommand('sleep 30');
    await sleep(1000);
    term.sendText('\x03', false);
    expect('terminal: Ctrl+C: quiet', await playsWithin(3000), false);
  }
  term.dispose();

  return { text: results.join('\n'), ok: !results.some(r => r.startsWith('FAIL')) };
}
