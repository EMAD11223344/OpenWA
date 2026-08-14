const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

const PORT = parseInt(process.env.PORT || '7860', 10);
const TARGET_PORT = parseInt(process.env.TARGET_PORT || '3333', 10);
const TARGET_HOST = '127.0.0.1';

// Locate Dashboard HTML
const DASHBOARD_PATHS = [
  path.join(__dirname, 'dashboard', 'index.html'),
  path.join('/app', 'dashboard', 'index.html'),
  path.join(__dirname, 'index.html')
];

function getDashboardHtml() {
  for (const p of DASHBOARD_PATHS) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  return '<h1>MultiWA Dashboard Loading...</h1>';
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // 1. Serve Dashboard on Root and /dashboard
  if (url === '/' || url === '/dashboard' || url === '/admin') {
    const html = getDashboardHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "frame-ancestors *;"
    });
    res.end(html);
    return;
  }

  // 2. Proxy API and Swagger Documentation to MultiWA Backend
  const proxyOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: req.headers.host || 'localhost'
    }
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // Clone headers and remove frame restrictions for Hugging Face iframe
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    headers['access-control-allow-origin'] = '*';
    headers['content-security-policy'] = "frame-ancestors *;";

    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy connection error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'MultiWA Backend starting up, please refresh...', details: err.message }));
    }
  });

  req.pipe(proxyReq, { end: true });
});

// 3. WebSocket Upgrade Proxy for /socket.io/
server.on('upgrade', (req, clientSocket, head) => {
  const targetSocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
    targetSocket.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
      Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n'
    );
    if (head && head.length > 0) targetSocket.write(head);
    targetSocket.pipe(clientSocket);
    clientSocket.pipe(targetSocket);
  });

  targetSocket.on('error', (err) => {
    console.error('WebSocket proxy error:', err.message);
    clientSocket.destroy();
  });
  clientSocket.on('error', () => targetSocket.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [MultiWA Gateway Proxy] Listening on http://0.0.0.0:${PORT}`);
  console.log(`📡 [MultiWA Gateway Proxy] Forwarding API traffic to internal port ${TARGET_PORT}`);
});
