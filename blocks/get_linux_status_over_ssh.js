'use strict';
const { connectSSH, executeSSH } = require('./send_ssh_command');

function memory(text) {
  const values = Object.fromEntries(String(text).trim().split(/\r?\n/)
    .map(line => line.split(/:\s+/)).filter(parts => parts.length === 2)
    .map(([key, value]) => [key, Number(value.match(/^\d+/)?.[0] || 0) * 1024]));
  const totalBytes = values.MemTotal || 0, availableBytes = values.MemAvailable || 0;
  return {
    totalBytes,
    availableBytes,
    usedBytes: Math.max(0, totalBytes - availableBytes),
    usedPercent: totalBytes ? Number(((totalBytes - availableBytes) / totalBytes * 100).toFixed(2)) : 0,
    swapTotalBytes: values.SwapTotal || 0,
    swapFreeBytes: values.SwapFree || 0
  };
}
function dfRows(text, multiplier = 1024) {
  return String(text).trim().split(/\r?\n/).slice(1).map(line => {
    const match = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!match) return null;
    const [, filesystem, total, used, available, usedPercent, mount] = match;
    return { filesystem, mount, totalBytes: Number(total) * multiplier, usedBytes: Number(used) * multiplier, availableBytes: Number(available) * multiplier, usedPercent: Number(usedPercent) };
  }).filter(Boolean);
}
function inodeRows(text) {
  return new Map(String(text).trim().split(/\r?\n/).slice(1).map(line => {
    const match = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!match) return null;
    return [match[6], { total: Number(match[2]), used: Number(match[3]), available: Number(match[4]), usedPercent: Number(match[5]) }];
  }).filter(Boolean));
}
function storage(filesystemText, inodeText, deviceText = '') {
  const inodes = inodeRows(inodeText);
  const filesystems = dfRows(filesystemText).map(row => ({ ...row, ...(inodes.has(row.mount) ? { inodes: inodes.get(row.mount) } : {}) }));
  const totals = filesystems.reduce((result, row) => {
    result.totalBytes += row.totalBytes; result.usedBytes += row.usedBytes; result.availableBytes += row.availableBytes; return result;
  }, { totalBytes: 0, usedBytes: 0, availableBytes: 0 });
  let devices = deviceText;
  try { devices = JSON.parse(deviceText).blockdevices || []; } catch {}
  return { ...totals, usedPercent: totals.totalBytes ? Number((totals.usedBytes / totals.totalBytes * 100).toFixed(2)) : 0, filesystems, devices };
}

module.exports = {
  type: 'get_linux_status_over_ssh', name: 'Get Linux Status Over SSH', category: 'Server Management',
  description: 'Collects CPU/load, RAM, storage, process, and networking status from a Linux host over SSH.',
  inputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'credential', name: 'Linux Credential', kind: 'value', types: ['linux_credential'], required: true }],
  fields: [], outputs: ['action', 'erroraction'],
  outputPorts: [{ id: 'action', name: 'Action', kind: 'action', types: [] }, { id: 'erroraction', name: 'Action (Error)', kind: 'action', types: [] }, { id: 'status', name: 'Status', kind: 'value', types: ['object'] }, { id: 'error', name: 'Error Message', kind: 'value', types: ['text'] }],
  async execute(ctx, _options, inputs, setOutput) {
    let connection;
    try {
      const credential = inputs.credential;
      if (credential?.type !== 'ssh') throw new Error('A Linux SSH credential is required');
      connection = await connectSSH(credential);
      const commands = {
        hostname: 'hostname', kernel: 'uname -srmo', uptime: 'cat /proc/uptime', loadAverage: 'cat /proc/loadavg',
        cpu: 'LC_ALL=C lscpu -J 2>/dev/null || lscpu', memory: 'cat /proc/meminfo',
        storage: 'LC_ALL=C df -Pk -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || LC_ALL=C df -Pk',
        inodes: 'LC_ALL=C df -Pi -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || LC_ALL=C df -Pi',
        devices: 'lsblk -J -b -o NAME,KNAME,TYPE,SIZE,FSTYPE,FSVER,LABEL,MOUNTPOINTS,ROTA,RO 2>/dev/null || true',
        processes: 'ps -eo pid,ppid,user,stat,%cpu,%mem,comm,args --sort=-%cpu',
        network: 'ip -j address 2>/dev/null || ip address', sockets: 'ss -s 2>/dev/null || netstat -s'
      };
      const raw = {};
      for (const [key, command] of Object.entries(commands)) { const result = await executeSSH(connection, command); raw[key] = result.stdout || result.stderr; }
      let network = raw.network; try { network = JSON.parse(network); } catch {}
      let cpu = raw.cpu; try { cpu = JSON.parse(cpu); } catch {}
      const processLines = raw.processes.split(/\r?\n/);
      const status = {
        collectedAt: new Date().toISOString(), host: credential.host, hostname: raw.hostname.trim(), kernel: raw.kernel.trim(),
        uptimeSeconds: Number(raw.uptime.split(/\s+/)[0]) || 0, loadAverage: raw.loadAverage.trim().split(/\s+/).slice(0, 3).map(Number),
        cpu, memory: memory(raw.memory), storage: storage(raw.storage, raw.inodes, raw.devices),
        processTable: { columns: processLines.shift() || '', rows: processLines.filter(Boolean) },
        network: { interfaces: network, socketSummary: raw.sockets }
      };
      setOutput('status', status); setOutput('error', ''); return 'action';
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      setOutput('error', error.message); return 'erroraction';
    } finally { connection?.end(); }
  },
  _test: { memory, dfRows, inodeRows, storage }
};
