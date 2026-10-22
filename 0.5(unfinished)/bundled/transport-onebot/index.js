import { createOneBotProvider } from './provider.js';
import { createRealProcessAdapters } from './processes.js';
import { createSnowlumaConnectionResolver } from './connection.js';
export default {
  setup(ctx) {
    const config = ctx.capability('host.config');
    const env = ctx.capability('host.environment');
    let active = null;
    const instanceCurrent = new WeakMap();
    ctx.registerTransport({ id: 'onebot', default: true, scopes: ['net.outbound', 'proc.exec'],
      create({ onEvent, onStatus, emit, signal, current = () => true }) {
        const cfg = () => config.get();
        const processes = createRealProcessAdapters({ appRoot: env.appRoot, emit });
        const connectionResolver = createSnowlumaConnectionResolver({ appRoot: env.appRoot });
        let provider, bindingSaveWarned = false;
        provider = createOneBotProvider({ cfg, log: ctx.log, onEvent, onStatus,
          portProbe: (url) => processes.snowluma.portOpen(url),
          connectionResolver,
          onVerifiedConnection(status) {
            if (active !== provider || signal?.aborted || !current() || typeof config.update !== 'function') return;
            const fresh = cfg(), selected = connectionResolver(fresh);
            if (String(fresh.snowluma?.accountId ?? '').trim() || selected.mode !== 'auto' || selected.connectionError
              || !selected.accountId || selected.bindingKey !== provider.client.bindingKey
              || String(status.selfId) !== selected.accountId || status.connection?.accountId !== selected.accountId) return;
            try {
              // Store only the verified identity in this profile's existing
              // config. Ports/tokens remain owned by SnowLuma and can rotate.
              config.update({ snowluma: { accountId: selected.accountId } });
              bindingSaveWarned = false;
            } catch {
              if (!bindingSaveWarned) ctx.log.warn?.('SnowLuma 已验证账号绑定无法保存；请在连接设置中填写 QQ 账号并保存，确保重启后继续连接同一账号。');
              bindingSaveWarned = true;
            }
          },
        });
        const start = provider.start.bind(provider);
        const stop = provider.stop.bind(provider);
        let offConfig = null;
        let startGeneration = 0;
        let startPromise = null;
        let running = false;
        const unsubscribe = () => { offConfig?.(); offConfig = null; };
        const instance = Object.assign(provider, { processes,
          async start() {
            if (running) return;
            if (startPromise) return startPromise;
            if (signal?.aborted || !current()) return;
            const generation = ++startGeneration;
            startPromise = (async () => {
              active = instance;
              if (cfg().snowluma?.autoLaunch) {
                const result = await processes.snowluma.ensureAutoLaunch({ config: cfg(), emit, log: ctx.log });
                if (result.error) ctx.log.warn?.(result.error);
              }
              if (signal?.aborted || !current() || generation !== startGeneration || active !== instance) return;
              if (!offConfig) offConfig = config.onChange?.(() => {
                if (active === instance && generation === startGeneration && !signal?.aborted && current()) provider.refreshConfig();
              }) ?? (() => {});
              try {
                await start();
                if (generation === startGeneration && active === instance) running = true;
              } catch (error) {
                if (generation === startGeneration) { unsubscribe(); if (active === instance) active = null; }
                throw error;
              }
            })();
            try { await startPromise; }
            finally { if (generation === startGeneration) startPromise = null; }
          },
          async stop() { ++startGeneration; running = false; startPromise = null; unsubscribe(); if (active === instance) active = null; await stop(); await processes.snowluma.shutdown(); },
        });
        instanceCurrent.set(instance, () => !signal?.aborted && current() && active === instance);
        return instance;
      },
    });
    const actions = ['addCustomFace', 'modifyCustomFace', 'deleteCustomFace', 'fetchCustomFaces', 'fetchCustomFaceDetails'];
    const identity = () => active && instanceCurrent.get(active)?.() ? active.actions.getAccountIdentity?.() ?? null : null;
    const favorites = Object.fromEntries(actions.map((name) => [name, async (...args) => {
      const instance = active, account = identity();
      if (!instance || !instanceCurrent.get(instance)?.() || typeof instance.actions?.[name] !== 'function') throw new Error(`当前协议端不支持 ${name}`);
      const result = await instance.actions[name](...args);
      const signal = args.find(value => value && typeof value === 'object' && value.signal)?.signal;
      if (signal?.aborted || active !== instance || !instanceCurrent.get(instance)?.() || identity() !== account) {
        throw Object.assign(new Error('收藏表情操作期间协议端已停止、账号已更改或操作已取消'), {
          code: 'QQ_EMOJI_CANCELLED', ...(name === 'addCustomFace' && result?.emojiId ? { remoteEffect: 'added', emojiId: String(result.emojiId) } : {}),
        });
      }
      return result;
    }]));
    favorites.getAccountIdentity = identity;
    ctx.registerCapability('qq.emoji-favorites', favorites, { default: true });
    ctx.lifecycle.onStop(() => active?.stop());
  },
};
