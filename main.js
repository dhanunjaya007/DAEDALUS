const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { PDFParse } = require('pdf-parse');
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');

function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

const http = require('http');

async function getEmbeddings(textChunks) {
  const vectors = [];
  for (const chunk of textChunks) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.request('http://localhost:11434/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(JSON.stringify({ model: 'nomic-embed-text', prompt: chunk }));
        req.end();
      });
      if (data.embedding) vectors.push({ text: chunk, vector: data.embedding });
    } catch (err) {
      console.error('Embedding failed for chunk', err);
    }
  }
  return vectors;
}

const CHATS_DIR = path.join(app.getPath('userData'), 'chats');
if (!fs.existsSync(CHATS_DIR)) {
  fs.mkdirSync(CHATS_DIR);
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('signal-chat.html');

  // Prevent links from navigating inside the app, open in default browser instead
  const { shell } = require('electron');
  
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL() && url.startsWith('http')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('load-chats', async () => {
  try {
    const files = fs.readdirSync(CHATS_DIR);
    const chats = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = fs.readFileSync(path.join(CHATS_DIR, file), 'utf8');
        try {
          chats.push(JSON.parse(content));
        } catch (e) {
          console.error(`Error parsing ${file}:`, e);
        }
      }
    }
    return chats;
  } catch (err) {
    console.error('Error loading chats:', err);
    return [];
  }
});

ipcMain.handle('save-chat', async (event, chatData) => {
  try {
    if (!chatData || !chatData.id) return { success: false, error: 'No chat ID' };
    const filePath = path.join(CHATS_DIR, `${chatData.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(chatData, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Error saving chat:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-chat', async (event, chatId) => {
  try {
    const filePath = path.join(CHATS_DIR, `${chatId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (err) {
    console.error('Error deleting chat:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('process-document', async (event, fileName, arrayBuffer) => {
  try {
    let text = '';
    const ext = path.extname(fileName).toLowerCase();
    const buffer = Buffer.from(arrayBuffer);
    if (ext === '.pdf') {
      const parser = new PDFParse(new Uint8Array(buffer));
      const data = await parser.getText();
      text = data.text;
    } else {
      text = buffer.toString('utf8');
    }
    
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return { success: false, error: 'Empty document' };
    
    const chunks = chunkText(text, 1000, 200);
    const vectors = await getEmbeddings(chunks);
    
    return { success: true, vectors };
  } catch (err) {
    console.error('Process document error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('search-web', async (event, query) => {
  try {
    const formData = new URLSearchParams();
    formData.append('q', query);
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: formData.toString()
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    
    const results = [];
    let currentTitle = '';
    let currentUrl = '';

    $('tr').each((i, el) => {
      if (results.length >= 3) return false;
      
      const link = $(el).find('.result-link');
      if (link.length > 0) {
        currentTitle = link.text().trim();
        currentUrl = link.attr('href');
      }
      
      const snippetEl = $(el).find('.result-snippet');
      if (snippetEl.length > 0) {
        const snippet = snippetEl.text().trim();
        if (currentTitle && snippet) {
          results.push({ title: currentTitle, snippet, url: currentUrl });
          currentTitle = '';
          currentUrl = '';
        }
      }
    });
    
    if (results.length === 0) {
      console.log("No DDG Lite results. HTML snippet:", html.slice(0, 500));
    }
    
    return { success: true, results };
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-chat', async (event, markdown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Chat',
    defaultPath: 'signal-chat-export.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (canceled || !filePath) return { success: false, error: 'cancelled' };
  try {
    fs.writeFileSync(filePath, markdown);
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('execute-code', async (event, toolName, code) => {
  return new Promise((resolve) => {
    let tmpFile, command;
    try {
      const os = require('os');
      const tmpDir = os.tmpdir();
      if (toolName === 'run_python') {
        tmpFile = path.join(tmpDir, `signal_script_${Date.now()}.py`);
        fs.writeFileSync(tmpFile, code);
        command = `python "${tmpFile}"`;
      } else {
        tmpFile = path.join(tmpDir, `signal_script_${Date.now()}.js`);
        fs.writeFileSync(tmpFile, code);
        command = `node "${tmpFile}"`;
      }
      
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch(e){}
        let output = stdout || '';
        if (stderr) output += '\n[stderr]\n' + stderr;
        if (error) output += '\n[error]\n' + error.message;
        resolve({ success: true, output: output.trim() });
      });
    } catch(e) {
      if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch(err){} }
      resolve({ success: false, error: e.message });
    }
  });
});

ipcMain.handle('load-data', async (event, key) => {
  const filePath = path.join(app.getPath('userData'), `data_${key}.json`);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch(e) { console.error('Error loading data:', e); }
  return null;
});

ipcMain.handle('save-data', async (event, key, data) => {
  const filePath = path.join(app.getPath('userData'), `data_${key}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data));
    return { success: true };
  } catch(e) {
    console.error('Error saving data:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fetch-youtube-transcript', async (event, url) => {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(url);
    const fullText = transcript.map(t => t.text).join(' ');
    return { success: true, text: fullText };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
