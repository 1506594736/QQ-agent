// SPEC §6.10 / §16 R-24: OneBot group/private sends may take 90s.
// Only this exact console action receives overhead for provider dispatch and the
// archive/HTTP acknowledgment. The host computes its budget from the allowlisted
// route; an iframe cannot supply or increase it. Market installs also need a
// bounded window for verification, the 120s package download and safe unpacking.
const TEST_SEND=/^\/api\/chats\/(group|private)_\d+\/test-send$/;
const DEFAULT_TIMEOUT_MS=15000;
const SEND_HOST_TIMEOUT_MS=100000;
const SEND_PANEL_TIMEOUT_MS=105000; // Let the host return its error before the panel waiter expires.

function isSlowSend(method,path){return String(method).toUpperCase()==='POST'&&typeof path==='string'&&TEST_SEND.test(path);}
const isMarketInstall=(method,path)=>String(method).toUpperCase()==='POST'&&path==='/api/market/install';
export function hostApiRequestTimeout(method,path,fallback=DEFAULT_TIMEOUT_MS){return isSlowSend(method,path)?SEND_HOST_TIMEOUT_MS:isMarketInstall(method,path)?180000:fallback;}
export function panelApiRequestTimeout(method,path){return isSlowSend(method,path)?SEND_PANEL_TIMEOUT_MS:isMarketInstall(method,path)?185000:DEFAULT_TIMEOUT_MS;}
