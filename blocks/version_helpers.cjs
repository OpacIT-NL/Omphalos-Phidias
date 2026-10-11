'use strict';

function versionInfo(ctx, revision) {
  const appName = String(ctx.appName || '').trim();
  const stage = String(ctx.deployment?.channel || '').trim();
  revision = Number(revision);
  if (!appName) throw new Error('The application name is unavailable');
  if (!['RC', 'Prod'].includes(stage)) throw new Error('This application has no RC or Prod release channel in config.json');
  if (!Number.isInteger(revision) || revision < 1) throw new Error('The application revision is unavailable');
  return { appName, stage, revision, version: `${appName}_${stage}_rev${revision}` };
}

async function limitedText(response, limit = 1024 * 1024) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error('Repository index exceeds 1 MiB');
  if (!response.body) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('Repository index exceeds 1 MiB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function latestVersionInfo(ctx, fetchImplementation = fetch) {
  const updateUrl = ctx.deployment?.updateUrl;
  if (!updateUrl) throw new Error(`No update URL is configured for the ${ctx.deployment?.channel || 'application'} release channel`);
  let archiveUrl;
  try { archiveUrl = new URL(updateUrl); } catch { throw new Error('The configured update URL is invalid'); }
  if (!['http:', 'https:'].includes(archiveUrl.protocol)) throw new Error('The configured update URL must use HTTP or HTTPS');

  const signal = ctx.signal
    ? AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  const archive = await fetchImplementation(archiveUrl, { method: 'HEAD', signal });
  if (!archive.ok) throw new Error(`Latest-version archive returned HTTP ${archive.status}`);

  const headerRevision = Number(archive.headers.get('x-phidias-revision'));
  const filenameRevision = Number(archiveUrl.pathname.match(/\.rev(\d+)\.zip$/i)?.[1]);
  let revision = Number.isInteger(headerRevision) && headerRevision > 0 ? headerRevision : filenameRevision;
  let appName = archive.headers.get('x-phidias-app-name') || ctx.appName;

  if (!Number.isInteger(revision) || revision < 1) {
    const indexUrl = new URL('./', archiveUrl);
    const response = await fetchImplementation(indexUrl, { headers: { accept: 'text/html' }, signal });
    if (!response.ok) throw new Error(`Repository index returned HTTP ${response.status}`);
    const html = await limitedText(response);
    const revisions = [...html.matchAll(/[a-z0-9._-]+\.rev(\d+)\.zip/gi)].map(match => Number(match[1])).filter(Number.isInteger);
    if (!revisions.length) throw new Error('The repository does not contain a numbered revision archive');
    revision = Math.max(...revisions);
  }

  return versionInfo({ ...ctx, appName }, revision);
}

const valueOutputs = label => [
  { id: 'version', name: label, kind: 'value', types: ['text'] },
  { id: 'app_name', name: 'Application Name', kind: 'value', types: ['text'] },
  { id: 'stage', name: 'Stage', kind: 'value', types: ['text'] },
  { id: 'revision', name: 'Revision', kind: 'value', types: ['number'] }
];

function setVersionOutputs(setOutput, info) {
  setOutput('version', info.version);
  setOutput('app_name', info.appName);
  setOutput('stage', info.stage);
  setOutput('revision', info.revision);
}

module.exports = { versionInfo, latestVersionInfo, valueOutputs, setVersionOutputs, limitedText };
