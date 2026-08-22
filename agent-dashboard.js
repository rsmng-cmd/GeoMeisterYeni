import { runDebuggerAgent } from './agents/debugger-agent.js';
import { runUIAnalyzer } from './agents/ui-analyzer-agent.js';
import { runInnovatorAgent } from './agents/innovator-agent.js';
import http from 'http';

const PORT = 3333;
let clients = [];
let logs = [];

function broadcast(data) {
  logs.push(data);
  const msg = 'data: ' + JSON.stringify(data) + '\n\n';
  clients.forEach(c => c.write(msg));
}

export function logAgent(agentName, message, type = 'info') {
  const payload = {
    timestamp: new Date().toLocaleTimeString('tr-TR'),
    agent: agentName,
    message,
    type
  };
  broadcast(payload);
}

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    clients.push(res);
    logs.forEach(l => res.write('data: ' + JSON.stringify(l) + '\n\n'));
    req.on('close', () => {
      clients = clients.filter(c => c !== res);
    });
    return;
  }

  if (req.url === '/run-pipeline') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started' }));
    runPipeline();
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>🤖 GeoMeister Agentic AI Live Console</title>
  <style>
    body { background: #090d16; color: #f8fafc; font-family: system-ui, sans-serif; margin: 0; padding: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 15px; }
    h1 { color: #818cf8; margin: 0; font-size: 1.4rem; }
    .status { background: #10b98122; color: #34d399; border: 1px solid #059669; padding: 4px 12px; border-radius: 99px; font-size: 0.8rem; font-weight: 600; }
    .btn { background: #6366f1; color: white; border: none; padding: 10px 18px; font-weight: 600; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
    .btn:hover { background: #4f46e5; }
    #log-container { background: #020617; border: 1px solid #1e293b; border-radius: 12px; height: 550px; overflow-y: auto; padding: 20px; margin-top: 20px; }
    .log-card { margin-bottom: 12px; padding: 12px 16px; border-radius: 8px; background: #0f172a; border-left: 4px solid #64748b; font-size: 0.9rem; line-height: 1.5; }
    .log-card.info { border-left-color: #38bdf8; }
    .log-card.success { border-left-color: #4ade80; background: #052e1622; }
    .log-card.error { border-left-color: #f87171; background: #450a0a22; }
    .log-card.prompt { border-left-color: #fbbf24; background: #451a0322; }
    .log-header { display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 6px; font-size: 0.85rem; }
    .agent-name { color: #818cf8; }
    .time { color: #64748b; }
    .content { white-space: pre-wrap; font-family: monospace; word-break: break-word; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🤖 GeoMeister Agentic AI Live Streaming Console</h1>
      <div style="color: #94a3b8; font-size: 0.85rem; margin-top: 4px;">Ajanların LLM ile canlı konuşmaları, prompt istekleri ve otonom karar akışı</div>
    </div>
    <div style="display: flex; gap: 15px; align-items: center;">
      <span class="status">● Canlı Akış Aktif</span>
      <button class="btn" onclick="triggerPipeline()">▶️ Ajanları Yeniden Çalıştır</button>
    </div>
  </div>

  <div id="log-container"></div>

  <script>
    const logBox = document.getElementById('log-container');
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(e) {
      const data = JSON.parse(e.data);
      const card = document.createElement('div');
      card.className = 'log-card ' + data.type;
      card.innerHTML = '<div class="log-header"><span class="agent-name">[' + data.agent + ']</span><span class="time">' + data.timestamp + '</span></div><div class="content">' + escapeHtml(data.message) + '</div>';
      logBox.appendChild(card);
      logBox.scrollTop = logBox.scrollHeight;
    };

    function escapeHtml(text) {
      return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function triggerPipeline() {
      fetch('/run-pipeline');
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

async function runPipeline() {
  logs = [];
  logAgent('Orchestrator', '🚀 Multi-Agent Otonom Döngüsü Başlatıldı.', 'info');
  
  const debugReport = await runDebuggerAgent((agent, msg, type) => logAgent(agent, msg, type));
  logAgent('Debugger Agent (Çıktı)', debugReport, 'success');

  const uiReport = await runUIAnalyzer((agent, msg, type) => logAgent(agent, msg, type));
  logAgent('UI/UX Analyzer (Çıktı)', uiReport, 'success');

  const ideasReport = await runInnovatorAgent((agent, msg, type) => logAgent(agent, msg, type));
  logAgent('Innovator Agent (Çıktı/Fikirler)', ideasReport, 'success');

  logAgent('Orchestrator', '🎉 Tüm Ajan Görevleri ve Analizler Başarıyla Tamamlandı!', 'success');
}

server.listen(PORT, () => {
  console.log('\n==================================================');
  console.log('🤖 Agentic AI Canlı Takip Konsolu: http://localhost:' + PORT);
  console.log('==================================================\n');
  runPipeline();
});
