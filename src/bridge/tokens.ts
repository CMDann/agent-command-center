/**
 * Parses bridge auth token secrets from the environment.
 *
 * Preferred: NEXUS_BRIDGE_TOKENS=tokenId1=secret1,tokenId2=secret2
 * Legacy:    NEXUS_BRIDGE_SECRET=secret (exposed as tokenId "default")
 */
export function loadBridgeTokensFromEnv(env = process.env): Record<string, string> {
  const rawTokens = env['NEXUS_BRIDGE_TOKENS'];
  if (rawTokens && rawTokens.trim()) {
    const tokens: Record<string, string> = {};
    for (const part of rawTokens.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) {
        throw new Error(
          `Invalid NEXUS_BRIDGE_TOKENS entry '${trimmed}'. Expected tokenId=secret.`
        );
      }
      const tokenId = trimmed.slice(0, idx).trim();
      const secret = trimmed.slice(idx + 1);
      if (!tokenId || !secret) {
        throw new Error(
          `Invalid NEXUS_BRIDGE_TOKENS entry '${trimmed}'. tokenId and secret must be non-empty.`
        );
      }
      tokens[tokenId] = secret;
    }
    if (Object.keys(tokens).length === 0) {
      throw new Error('NEXUS_BRIDGE_TOKENS did not contain any usable tokenId=secret pairs');
    }
    return tokens;
  }

  const legacy = env['NEXUS_BRIDGE_SECRET'];
  if (legacy && legacy.trim()) {
    return { default: legacy };
  }

  throw new Error(
    'Bridge auth is not configured. Set NEXUS_BRIDGE_TOKENS (preferred) or NEXUS_BRIDGE_SECRET.'
  );
}
