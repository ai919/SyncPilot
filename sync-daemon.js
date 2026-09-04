const http = require('http');
const { exec } = require('child_process');

// 启动本地轻量选择器服务 (端口 29170)
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/pick-folder') {
    // 唤起 Windows 原生文件夹选取窗口 (通过一段微型 PowerShell)
    const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '请选择 SyncPilot 代码同步根目录'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath }"`;
    
    exec(psCmd, (err, stdout) => {
      const selected = stdout ? stdout.trim() : '';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ path: selected }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(29170, '127.0.0.1', () => {
  console.log('[SyncPilot] 文件夹选择器服务已就绪: http://127.0.0.1:29170');
});