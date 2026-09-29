const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.css'), 'utf8')
const srcDir = path.join(__dirname, '..', 'src')
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.tsx'))
const used = new Set()
const where = new Map()

for (const f of files) {
  const s = fs.readFileSync(path.join(srcDir, f), 'utf8')
  const add = (c) => {
    if (!c || c.includes('$') || c.includes('{')) return
    used.add(c)
    if (!where.has(c)) where.set(c, [])
    if (where.get(c).length < 3) where.get(c).push(f)
  }
  for (const m of s.matchAll(/className="([^"]+)"/g)) m[1].split(/\s+/).forEach(add)
  for (const m of s.matchAll(/className=\{`([^`]+)`\}/g)) m[1].split(/\s+/).forEach(add)
  for (const m of s.matchAll(/class(Name)?=\{'([^']+)'}/g)) m[2].split(/\s+/).forEach(add)
  // ternary class strings: className={cond ? 'a b' : 'c d'}
  for (const m of s.matchAll(/className=\{[^}]*?['"]([a-z][a-z0-9 -]*)['"]\s*(?::|\/\*)/g)) {
    m[1].split(/\s+/).forEach(add)
  }
}

const has = (c) => new RegExp('[.\\s]' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-zA-Z0-9_-])').test(css)
// Tailwind-style utilities and dynamic fragments are not semantic classes
const isUtility = (c) =>
  /^(sm|md|lg|xl|hover|focus|dark):/.test(c) ||
  /^(p|m|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|gap|grid|flex|w|h|min-w|max-w|text|bg|border|rounded|shadow|font|leading|tracking|items|justify|space|inset|top|bottom|left|right|z|overflow|whitespace|truncate|line|aspect|col|row|order|self|place|basis|grow|shrink|duration|delay|ease|transition|animate|opacity|cursor|select|pointer|resize|list|decoration|underline|uppercase|lowercase|capitalize|italic|not-italic|antialiased|tabular|ordinal|slashed|lining|oldstyle|diagonal|hidden|block|inline|table|contents|flex-|absolute|relative|fixed|sticky)-/.test(c) ||
  /^!/.test(c) ||
  /^[\d.]/.test(c) ||
  !/^[a-z][a-z0-9-]*$/.test(c)
const missing = [...used].filter((c) => !has(c) && !isUtility(c)).sort()
console.log('MISSING (' + missing.length + '):')
for (const c of missing) console.log('  .' + c + '  <- ' + where.get(c).join(', '))
