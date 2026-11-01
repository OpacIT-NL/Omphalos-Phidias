'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');

const defaults = Object.freeze({ authorizedNetworks: [], trustedProxies: [] });
const error = message => Object.assign(new Error(message), { status: 400 });

function normalizeAddress(value) {
  let address = String(value || '').trim().toLowerCase();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  const zone = address.indexOf('%');
  if (zone >= 0) address = address.slice(0, zone);
  if (address.startsWith('::ffff:') && net.isIPv4(address.slice(7))) address = address.slice(7);
  return net.isIP(address) ? address : null;
}

function normalizeNetworks(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw error(`${label} must be a list of CIDR networks`);
  if (value.length > 256) throw error(`${label} cannot contain more than 256 networks`);
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') throw error(`${label} entries must use CIDR notation`);
    const cidr = item.trim(), parts = cidr.split('/');
    if (parts.length !== 2) throw error(`${label} entries must use CIDR notation, such as 192.0.2.0/24`);
    const address = normalizeAddress(parts[0]), family = address ? net.isIP(address) : 0, prefix = Number(parts[1]);
    const maximum = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) throw error(`Invalid CIDR network in ${label}: ${cidr}`);
    const block = new net.BlockList();
    try { block.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6'); }
    catch { throw error(`Invalid CIDR network in ${label}: ${cidr}`); }
    const normalized = `${address}/${prefix}`;
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function normalizeRepositorySettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('Repository settings must be an object');
  return {
    authorizedNetworks: normalizeNetworks(value.authorizedNetworks, 'Authorized networks'),
    trustedProxies: normalizeNetworks(value.trustedProxies, 'Trusted proxies')
  };
}

function networkList(networks) {
  return networks.map(cidr => {
    const [address, prefix] = cidr.split('/');
    const family = net.isIP(address);
    const block = new net.BlockList();
    block.addSubnet(address, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');
    return { block, family };
  });
}

function addressInNetworks(address, networks) {
  address = normalizeAddress(address);
  if (!address) return false;
  const family = net.isIP(address);
  return networks.some(network => network.family === family && network.block.check(address, family === 4 ? 'ipv4' : 'ipv6'));
}

function clientAddress(request, trustedNetworks) {
  const direct = normalizeAddress(request?.socket?.remoteAddress);
  if (!direct || !addressInNetworks(direct, trustedNetworks)) return direct;
  const header = request.headers?.['x-forwarded-for'];
  if (typeof header !== 'string' || header.length > 2048) return direct;
  const forwarded = header.split(',').map(normalizeAddress);
  if (!forwarded.length || forwarded.length > 32 || forwarded.some(address => !address)) return direct;
  let current = direct;
  for (let index = forwarded.length - 1; index >= 0 && addressInNetworks(current, trustedNetworks); index--) current = forwarded[index];
  return current;
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, contents, { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

class RepositorySettings {
  constructor(file) {
    this.file = file;
    this.value = { ...defaults };
    this.authorized = [];
    this.proxies = [];
  }
  async init() {
    try { this.value = normalizeRepositorySettings(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
      this.value = { authorizedNetworks: [], trustedProxies: [] };
    }
    this.compile();
    return this;
  }
  compile() {
    this.authorized = networkList(this.value.authorizedNetworks);
    this.proxies = networkList(this.value.trustedProxies);
  }
  get() { return structuredClone(this.value); }
  async save(value) {
    const normalized = normalizeRepositorySettings(value);
    await atomicWrite(this.file, JSON.stringify(normalized, null, 2) + '\n');
    this.value = normalized;
    this.compile();
    return this.get();
  }
  clientAddress(request) { return clientAddress(request, this.proxies); }
  authorizes(request) { return addressInNetworks(this.clientAddress(request), this.authorized); }
}

module.exports = { RepositorySettings, normalizeRepositorySettings, normalizeAddress, addressInNetworks, clientAddress };
