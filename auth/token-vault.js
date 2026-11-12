const encoder = new TextEncoder();
const encode = bytes => Buffer.from(bytes).toString('base64url');
const decode = value => new Uint8Array(Buffer.from(value, 'base64url'));
const aad = context => encoder.encode(JSON.stringify(['oauth-local', context.slot, context.generation, context.version, context.keyVersion]));
export function createTokenVault({ keys = {}, activeVersion = 'v1' } = {}) {
  async function key(version) {
    const raw = keys[version];
    if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(raw) || Buffer.from(raw, 'base64').length !== 32) throw new Error('vault_unavailable');
    return crypto.subtle.importKey('raw', Buffer.from(raw, 'base64'), 'AES-GCM', false, ['encrypt','decrypt']);
  }
  return {
    async ready() { await key(activeVersion); },
    async seal(tokens, { slot, generation, version }) {
      const context = { slot, generation, version, keyVersion: activeVersion };
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv:nonce, additionalData:aad(context) }, await key(activeVersion), encoder.encode(JSON.stringify(tokens)));
      return { ...context, nonce:encode(nonce), ciphertext:encode(ciphertext) };
    },
    async open(envelope, expected) {
      try {
        if (!envelope || envelope.slot !== expected.slot || envelope.generation !== expected.generation || envelope.version !== expected.version || decode(envelope.nonce).length !== 12) throw new Error();
        const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv:decode(envelope.nonce), additionalData:aad(envelope) }, await key(envelope.keyVersion), decode(envelope.ciphertext));
        return JSON.parse(new TextDecoder().decode(plain));
      } catch { throw new Error('vault_unavailable'); }
    },
  };
}
