// Human voice-over clips for Aral Math.
// GET  /api/voice           -> {clips: {id: updatedAt}}           (anyone signed in)
// GET  /api/voice?id=X      -> the audio file (WAV)
// POST /api/voice {id, b64} -> save a recording;  {id, delete:true} -> remove   (teacher, principal, admin)
import {getSession, getUser, send, body, wrap, voiceList, voiceGet, voicePut, voiceDel} from './_lib.js';
const CAN_RECORD = new Set(['teacher', 'principal', 'admin']);
const ID = /^[a-z0-9' ?!.,:-]{1,140}$/;
export default wrap(async (req, res) => {
  const s = getSession(req); if (!s) return send(res, 401, {error: 'Not signed in'});
  if (req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    if (!id) return send(res, 200, {clips: await voiceList()});
    const clip = await voiceGet(id); if (!clip) return send(res, 404, {error: 'No recording'});
    res.statusCode = 200; res.setHeader('Content-Type', clip.mime); res.setHeader('Cache-Control', 'private, max-age=86400'); return res.end(clip.buf);
  }
  if (req.method !== 'POST') return send(res, 405, {error: 'GET or POST'});
  const me = await getUser(s.u); if (!me || me.status !== 'active' || !CAN_RECORD.has(me.role)) return send(res, 403, {error: 'Only teachers can record the voice-over.'});
  const b = await body(req), id = String(b.id || '');
  if (!ID.test(id)) return send(res, 400, {error: 'Bad clip id'});
  if (b.delete) { await voiceDel(id); return send(res, 200, {ok: true}); }
  const b64 = String(b.b64 || ''); if (!b64 || b64.length > 1.4e6) return send(res, 400, {error: 'Recording missing or too long (keep each line under 30 seconds).'});
  await voicePut(id, 'audio/wav', b64, s.u); send(res, 200, {ok: true});
});
