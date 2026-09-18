import net from 'node:net';

function probeHost(host) {
  if (!host || host === '0.0.0.0') return '127.0.0.1';
  if (host === '::') return '::1';
  return host.replace(/^\[|\]$/g, '');
}

function formatHost(host) {
  const targetHost = probeHost(host);
  return targetHost.includes(':') && !targetHost.startsWith('[')
    ? `[${targetHost}]`
    : targetHost;
}

function sleep(ms, signal) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortOpen(host, port, timeoutMs) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function classifyListener({
  host,
  port,
  expectedService,
  healthPath = '/health',
  timeoutMs = 1500,
}) {
  const targetHost = probeHost(host);
  const open = await isPortOpen(targetHost, port, timeoutMs);
  if (!open) return { state: 'free' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${formatHost(host)}:${port}${healthPath}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // A listener exists, but it is not exposing the expected JSON health identity.
    }

    if (response.ok && body?.ok === true && body?.service === expectedService) {
      return { state: 'expected', status: response.status };
    }

    return { state: 'unexpected', status: response.status };
  } catch (error) {
    return {
      state: 'unexpected',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function startWithPortGuard({
  host,
  port,
  expectedService,
  start,
  healthPath = '/health',
  probeTimeoutMs = 1500,
  recheckMs = 2000,
  logger = console,
  classify = classifyListener,
  sleepFn = sleep,
}) {
  let waitingOnExisting = false;

  for (;;) {
    const listener = await classify({
      host,
      port,
      expectedService,
      healthPath,
      timeoutMs: probeTimeoutMs,
    });

    if (listener.state === 'free') {
      if (waitingOnExisting) {
        logger?.warn?.(`${expectedService}: previous listener on ${host}:${port} disappeared; taking ownership.`);
      }
      try {
        return await start();
      } catch (error) {
        if (error?.code === 'EADDRINUSE') {
          waitingOnExisting = true;
          logger?.warn?.(`${expectedService}: bind raced with another listener on ${host}:${port}; rechecking.`);
          await sleepFn(recheckMs);
          continue;
        }
        throw error;
      }
    }

    if (listener.state === 'expected') {
      if (!waitingOnExisting) {
        logger?.warn?.(
          `${expectedService}: a healthy existing TrackMaster listener already owns ${host}:${port}; ` +
          'holding this PM2 wrapper instead of entering an EADDRINUSE restart loop.',
        );
      }
      waitingOnExisting = true;
      await sleepFn(recheckMs);
      continue;
    }

    throw new Error(
      `${expectedService}: port ${host}:${port} is occupied by an unknown listener. ` +
      `The health probe ${formatHost(host)}:${port}${healthPath} did not identify TrackMaster. ` +
      'Stop the unrelated process or configure a different port, then restart PM2. No process was terminated.',
    );
  }
}
