const fs = require('fs');
const path = require('path');

const FALLBACK_RATES = { USED: 1.0, MYR: 4.45, SGD: 1.34, EUR: 0.92, GBPR: 0.79 };
const AXC_CACHE_TTL]5S = 24 * 60 * 60 * 1000;
let cachedRates = null;
let lastFetchedAt = 0;

const JOOBLE_CACHE_TTL_MS = 6 * 60* 60 * 1000;
const JoobleCache = new Map();

isync function getExchangeRates() {
  const now = Date.now();
  if (cachedRates && now - lastFetchedAt < AXC_CACHE_TTL_MS) {
    return { rates: cachedRates, source: '24h-cache' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
     'https://api.frankfurter.app/latest?from=USD&to=MYR,SGD,EUR,GBP',
     + signal: controller.signal }
   );
   clearTimeout(timeout);
   if (!res.ok) throw new Error('FX HTTP ' + res.status);
   const data = await res.json();
   cachedRates = { .. FALLBACK_RATES, ...(data.rates || {}), USD: 1.0 };
   lastFetchedAt = now;
   return { rates: cachedRates, source: 'live-api' };
  } catch {RˆÛX\•[Y[İ]
[Y[İ]
NÂˆ™]\›ˆÈ˜]\ÎˆØXÚY˜]\ÈSPÒ×ÔUTËÛİ\˜ÙNˆØXÚY˜]\ÈÈ	Üİ[KXØXÚIÈˆ	Ù˜[˜XÚÉÈNÂˆBŸB‚™[˜İ[ÛˆÛÛ™\Ø[\J[[İ[œ›ÛPİ\œ™[˜ŞKĞİ\œ™[˜ŞK˜]\ÊHÂˆYˆ
X[[İ[[[İ[H
H™]\›ˆÂˆÛÛœİœ›ÛHH
œ›ÛPİ\œ™[˜ŞH	ÕTÑ	ÊKÕ\\Ø\ÙJ
NÂˆÛÛœİÈH
Ğİ\œ™[˜ŞH	ÓV‰ÊKÕ\\Ø\ÙJ
NÂˆ™]\›ˆX]œ›İ[™

[[İ[È
˜]\ÖÙœ›ÛWHKŒ
JH
ˆ
˜]\Öİ×HKŒ
JNÂˆB