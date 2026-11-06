'use strict';
function boundedText(value, maximum, allowEmpty = false) {
  return typeof value === 'string' && value.length <= maximum && (allowEmpty || Boolean(value.trim())) && !/[\u0000-\u001f\u007f]/u.test(value);
}
function sourceValue(value) {
  if (!value || !boundedText(value.id, 1024) || !boundedText(value.name, 1024) || !Array.isArray(value.languages) || value.languages.length > 256 || value.languages.some(tag => !boundedText(tag, 64, true))) return null;
  return { id: value.id, name: value.name, languages: [...value.languages] };
}
function languageCode(source) {
  const tag = source?.languages?.[0];
  if (typeof tag !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag)) return '--';
  const primary = tag.split('-')[0].toUpperCase();
  return ['UND', 'MUL', 'ZXX'].includes(primary) ? '--' : primary;
}
function nextSourceId(currentId, sources) {
  if (!Array.isArray(sources) || sources.length > 256) return null;
  const ids = [];
  for (const source of sources) if (sourceValue(source) && !ids.includes(source.id)) ids.push(source.id);
  if (!ids.length) return null;
  return ids[(ids.indexOf(currentId) + 1) % ids.length];
}
function normalizeState(value) {
  if (!value || value.type !== 'state' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.sources) || value.sources.length > 256) return null;
  if (value.id !== undefined && (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id))) return null;
  if (value.targetToken !== undefined && (typeof value.targetToken !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.targetToken))) return null;
  const current = value.current === null ? null : sourceValue(value.current);
  if (value.current !== null && !current) return null;
  const sources = [], ids = new Set();
  for (const source of value.sources) {
    const clean = sourceValue(source);
    if (!clean) return null;
    if (!ids.has(clean.id)) { sources.push(clean); ids.add(clean.id); }
  }
  return { type: 'state', revision: value.revision, ...(value.id === undefined ? {} : { id: value.id }), ...(value.targetToken === undefined ? {} : { targetToken: value.targetToken }), current, sources };
}
module.exports = { languageCode, nextSourceId, normalizeState };
