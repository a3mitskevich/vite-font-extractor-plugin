export function createCachedImport<T> (imp: () => Promise<T>): () => T | Promise<T> {
  let cached: T | Promise<T>
  return async () => {
    if (!cached) {
      cached = imp().then((module) => {
        cached = module
        return module
      })
    }
    return cached
  }
}
