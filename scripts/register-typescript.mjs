// Node 24 supports TypeScript transformation without tsx's IPC/user-info setup.
import { registerHooks, stripTypeScriptTypes } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (
        error.code !== 'ERR_MODULE_NOT_FOUND' ||
        !specifier.startsWith('.') ||
        /\.[a-z]+$/i.test(specifier)
      )
        throw error
      return nextResolve(specifier + '.ts', context)
    }
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (url.endsWith('.ts') && !url.includes('/node_modules/')) {
      return {
        ...result,
        format: 'module',
        source: stripTypeScriptTypes(String(result.source), {
          mode: 'transform',
          sourceUrl: url,
        }),
      }
    }
    return result
  },
})
