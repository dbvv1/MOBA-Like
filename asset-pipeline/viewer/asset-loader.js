// Share at most one load per key, allow failed loads to retry, ignore stale results.
export function createAssetLoader(fetchAsset) {
  const cache = new Map();
  let generation = 0;
  return async key => {
    const request = ++generation;
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => fetchAsset(key)));
    const pending = cache.get(key);
    try {
      const asset = await pending;
      return request === generation ? asset : null;
    } catch (error) {
      if (cache.get(key) === pending) cache.delete(key);
      if (request !== generation) return null;
      throw error;
    }
  };
}
